// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {dedupeActivityItems, withCanonicalId} from './canonical';
import type {ActivityAggregationService as ActivityAggregationServiceContract, ActivityLoadContext} from './interfaces';
import {mergeActivityItems} from './merge';
import type {ActivityEventKind, ActivityItem, ActivityPage, PersistedActivityState} from './types';
import {deserializePersistedActivityState, serializePersistedActivityState} from './persistence';
import {logActivityError, toErrorMessage} from './errors';

import {getUserAvatarURL} from './api';
import {DMGMAdapter} from './adapters/dmGmAdapter';
import {MentionsAdapter} from './adapters/mentionsAdapter';
import {ReactionsAdapter} from './adapters/reactionsAdapter';
import {RemindersAdapter} from './adapters/remindersAdapter';
import {ThreadsAdapter} from './adapters/threadsAdapter';
import type {ActivitySourceAdapter} from './adapters/types';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PERSISTED_ITEMS = 5000;
const INITIAL_MIN_NEW_ITEMS = 30;
const INITIAL_MAX_ITERATIONS = 1;
const OLDER_MIN_NEW_ITEMS = 100;
const OLDER_MAX_ITERATIONS = 20;
const DISPLAY_WINDOW_STEP_MS = 7 * 24 * 60 * 60 * 1000;

type AdapterCursorMap = Partial<Record<ActivityEventKind, string>>;

const STORAGE_KEY_PREFIX = 'mm-webapp-activity-state';

function getStorageKey(serverId: string) {
    const normalized = (serverId || '').trim() || 'global';
    return `${STORAGE_KEY_PREFIX}:${normalized}`;
}

function parsePage(cursor?: string): number {
    if (!cursor) {
        return 0;
    }
    const page = Number(cursor);
    return Number.isFinite(page) ? page : 0;
}

function resolveInitialVisibleSince(nowMs: number): number {
    return Math.max(0, nowMs - DISPLAY_WINDOW_STEP_MS);
}

function resolveVisibleSince(mode: 'initial' | 'older', nowMs: number, state?: PersistedActivityState): number {
    const previousVisibleSince = state?.checkpoint?.visibleSinceMs ?? resolveInitialVisibleSince(nowMs);
    if (mode === 'older') {
        return Math.max(0, previousVisibleSince - DISPLAY_WINDOW_STEP_MS);
    }
    return previousVisibleSince;
}

function toPersistedState(context: ActivityLoadContext, page: ActivityPage, allItems = page.items): PersistedActivityState {
    return {
        serverId: context.serverId,
        fetchedAt: Date.now(),
        uiCursor: page.uiCursor,
        sourceCursors: page.sourceCursors,
        checkpoint: page.checkpoint,
        items: allItems.slice(0, MAX_PERSISTED_ITEMS).map((item) => ({
            canonicalId: item.canonicalId,
            eventKind: item.eventKind,
            serverId: item.serverId,
            targetUserId: item.targetUserId,
            eventTs: item.eventTs,
            previewText: item.previewText,
            postId: item.postId,
            reminderId: item.reminderId,
            channelId: item.channelId,
            threadId: item.threadId,
            actorUserId: item.actorUserId,
            actorAvatarUrl: item.actorAvatarUrl,
            isUnread: item.isUnread,
            sourceRef: item.sourceRef,
        })),
    };
}

function loadFromLocalStorage(serverId: string): PersistedActivityState | null {
    try {
        const raw = window.localStorage.getItem(getStorageKey(serverId));
        if (!raw) {
            return null;
        }
        return deserializePersistedActivityState(raw);
    } catch (error) {
        logActivityError('failed to read persisted state', error);
        return null;
    }
}

function saveToLocalStorage(state: PersistedActivityState) {
    try {
        window.localStorage.setItem(getStorageKey(state.serverId), serializePersistedActivityState(state));
    } catch (error) {
        // Keep Activity usable even when storage is unavailable.
        logActivityError('failed to persist state', error);
    }
}

export class ActivityAggregationService implements ActivityAggregationServiceContract {
    private readonly adapters: ActivitySourceAdapter[];
    private readonly memoryState = new Map<string, PersistedActivityState>();

    constructor() {
        this.adapters = [
            new MentionsAdapter(),
            new ThreadsAdapter(),
            new ReactionsAdapter(),
            new DMGMAdapter(),
            new RemindersAdapter(),
        ];
    }

    emptyPage = (): ActivityPage => {
        return {
            items: [],
            uiCursor: undefined,
            sourceCursors: {},
            checkpoint: {
                watermarkTs: 0,
                mergeSequence: 0,
            },
            errors: [],
            hasMore: false,
        };
    };

    getState = (serverId: string): PersistedActivityState | null => {
        const memoryState = this.memoryState.get(serverId);
        if (memoryState) {
            return memoryState;
        }

        const diskState = loadFromLocalStorage(serverId);
        if (diskState) {
            this.memoryState.set(serverId, diskState);
        }
        return diskState;
    };

    private fetchAdapters = async (
        context: ActivityLoadContext,
        mode: 'initial' | 'older',
        state?: PersistedActivityState,
    ): Promise<{page: ActivityPage; allItems: ActivityItem[]}> => {
        const nowMs = context.nowMs || Date.now();
        const pageSize = context.pageSize || DEFAULT_PAGE_SIZE;
        const visibleSinceMs = resolveVisibleSince(mode, nowMs, state);
        const sinceMs = visibleSinceMs;
        const beforeMs = undefined;
        const errors: ActivityPage['errors'] = [];

        const runAdapters = async (adapters: ActivitySourceAdapter[], cursorMap: AdapterCursorMap): Promise<{
            items: ActivityItem[];
            nextCursorMap: AdapterCursorMap;
            activeKinds: Set<ActivityEventKind>;
        }> => {
            const nextCursorMap: AdapterCursorMap = {};
            const activeKinds = new Set<ActivityEventKind>();

            const runs = adapters.map(async (adapter) => {
                const cursor = cursorMap[adapter.kind];
                const page = parsePage(cursor);

                let result;
                try {
                    result = await adapter.fetch({
                        serverId: context.serverId,
                        userId: context.userId,
                        pageSize,
                        page,
                        sinceMs,
                        beforeMs,
                    });
                } catch (error) {
                    // A throwing adapter must not blank the whole feed.
                    logActivityError(`adapter ${adapter.kind} failed`, error);
                    errors.push({
                        source: adapter.kind,
                        message: toErrorMessage(error, `${adapter.kind} source failed`),
                        retriable: true,
                    });
                    return [];
                }

                if (result.nextCursor) {
                    nextCursorMap[adapter.kind] = result.nextCursor;
                    activeKinds.add(adapter.kind);
                }

                if (result.error) {
                    errors.push({
                        source: adapter.kind,
                        message: result.error,
                        retriable: true,
                    });
                }

                return result.items;
            });

            return {
                items: (await Promise.all(runs)).flat().map(withCanonicalId),
                nextCursorMap,
                activeKinds,
            };
        };

        let merged: ActivityItem[] = mode === 'older' && state ? state.items : [];
        let sourceCursors: AdapterCursorMap = {};

        const targetNewItems = mode === 'older' ? OLDER_MIN_NEW_ITEMS : INITIAL_MIN_NEW_ITEMS;
        const maxIterations = mode === 'older' ? OLDER_MAX_ITERATIONS : INITIAL_MAX_ITERATIONS;

        let totalNewItems = 0;
        let activeAdapters = this.adapters;
        let cursorMap: AdapterCursorMap = mode === 'older' && state ? {...(state.sourceCursors || {})} : {};

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            if (!activeAdapters.length || totalNewItems >= targetNewItems) {
                break;
            }

            // Adapter cursors from one round are required to construct the next round.
            // eslint-disable-next-line no-await-in-loop
            const round = await runAdapters(activeAdapters, cursorMap);
            const nextMerged = mode === 'older' && state ? mergeActivityItems(merged, round.items) : dedupeActivityItems([...merged, ...round.items]);
            const newlyAdded = Math.max(0, nextMerged.length - merged.length);

            merged = nextMerged;
            totalNewItems += newlyAdded;

            sourceCursors = round.nextCursorMap;
            cursorMap = round.nextCursorMap;
            activeAdapters = this.adapters.filter((adapter) => round.activeKinds.has(adapter.kind));

            // Stop immediately when no new items are added in a round.
            if (newlyAdded === 0) {
                break;
            }
        }

        const sorted = mergeActivityItems([], merged);
        const visibleItems = sorted.filter((item) => item.eventTs >= visibleSinceMs);
        const hasHiddenOlderItems = sorted.length > visibleItems.length;
        const watermarkTs = sorted.length ? sorted[sorted.length - 1].eventTs : (state?.checkpoint.watermarkTs || 0);

        return {
            page: {
                items: visibleItems.slice(0, MAX_PERSISTED_ITEMS),
                uiCursor: String(watermarkTs || nowMs),
                sourceCursors,
                checkpoint: {
                    watermarkTs,
                    mergeSequence: (state?.checkpoint.mergeSequence || 0) + 1,
                    visibleSinceMs,
                },
                errors,
                hasMore: hasHiddenOlderItems || Object.values(sourceCursors).some(Boolean),
            },
            allItems: sorted.slice(0, MAX_PERSISTED_ITEMS),
        };
    };

    private loadAndPersist = async (
        context: ActivityLoadContext,
        mode: 'initial' | 'older',
        state?: PersistedActivityState,
    ): Promise<ActivityPage> => {
        const result = await this.fetchAdapters(context, mode, state);
        const persisted = toPersistedState(context, result.page, result.allItems);
        this.memoryState.set(context.serverId, persisted);
        saveToLocalStorage(persisted);
        return result.page;
    };

    loadInitial = (context: ActivityLoadContext): Promise<ActivityPage> => {
        return this.loadAndPersist(context, 'initial');
    };

    loadOlder = (context: ActivityLoadContext, state: PersistedActivityState): Promise<ActivityPage> => {
        return this.loadAndPersist(context, 'older', state);
    };

    refresh = (context: ActivityLoadContext, state?: PersistedActivityState): Promise<ActivityPage> => {
        return this.loadAndPersist(context, 'initial', state);
    };

    searchLocal = (query: string, items: ActivityItem[]): ActivityItem[] => {
        const normalized = query.trim().toLowerCase();
        const hydrated = items.map((item) => {
            if (item.actorAvatarUrl || !item.actorUserId) {
                return item;
            }
            return {
                ...item,
                actorAvatarUrl: getUserAvatarURL(item.actorUserId),
            };
        });

        if (!normalized) {
            return hydrated;
        }

        return hydrated.filter((item) => {
            const haystack = [
                item.previewText,
                item.channelId,
                item.threadId,
                item.postId,
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(normalized);
        });
    };
}

const activityAggregationService = new ActivityAggregationService();
export default activityAggregationService;

