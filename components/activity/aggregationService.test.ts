// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {ActivityAggregationService} from './aggregationService';
import type {AdapterFetchParams, AdapterFetchResult} from './adapters/types';
import type {ActivityItem, PersistedActivityState} from './types';

type FetchMock = jest.MockedFunction<(params: AdapterFetchParams) => Promise<AdapterFetchResult>>;

const mockMentionsFetch: FetchMock = jest.fn();
const mockThreadsFetch: FetchMock = jest.fn();
const mockReactionsFetch: FetchMock = jest.fn();
const mockDmGmFetch: FetchMock = jest.fn();
const mockRemindersFetch: FetchMock = jest.fn();

jest.mock('./adapters/mentionsAdapter', () => ({
    MentionsAdapter: class {
        kind = 'mention';
        fetch = (params: AdapterFetchParams) => mockMentionsFetch(params);
    },
}));
jest.mock('./adapters/threadsAdapter', () => ({
    ThreadsAdapter: class {
        kind = 'thread_reply';
        fetch = (params: AdapterFetchParams) => mockThreadsFetch(params);
    },
}));
jest.mock('./adapters/reactionsAdapter', () => ({
    ReactionsAdapter: class {
        kind = 'reaction';
        fetch = (params: AdapterFetchParams) => mockReactionsFetch(params);
    },
}));
jest.mock('./adapters/dmGmAdapter', () => ({
    DMGMAdapter: class {
        kind = 'dm';
        fetch = (params: AdapterFetchParams) => mockDmGmFetch(params);
    },
}));
jest.mock('./adapters/remindersAdapter', () => ({
    RemindersAdapter: class {
        kind = 'reminder';
        fetch = (params: AdapterFetchParams) => mockRemindersFetch(params);
    },
}));

const NOW = 1_700_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
    return {
        canonicalId: '',
        eventKind: 'mention',
        serverId: 'server-1',
        targetUserId: 'user-1',
        eventTs: NOW - 1000,
        previewText: 'preview',
        ...overrides,
    };
}

function emptyResult(kind: AdapterFetchResult['kind']): AdapterFetchResult {
    return {kind, items: [], nextCursor: undefined};
}

describe('ActivityAggregationService', () => {
    beforeEach(() => {
        window.localStorage.clear();
        mockMentionsFetch.mockResolvedValue(emptyResult('mention'));
        mockThreadsFetch.mockResolvedValue(emptyResult('thread_reply'));
        mockReactionsFetch.mockResolvedValue(emptyResult('reaction'));
        mockDmGmFetch.mockResolvedValue(emptyResult('dm'));
        mockRemindersFetch.mockResolvedValue(emptyResult('reminder'));
    });

    test('emptyPage describes an empty feed', () => {
        expect(new ActivityAggregationService().emptyPage()).toEqual({
            items: [],
            uiCursor: undefined,
            sourceCursors: {},
            checkpoint: {watermarkTs: 0, mergeSequence: 0},
            errors: [],
            hasMore: false,
        });
    });

    test('loadInitial merges adapter items, sorts them and persists state', async () => {
        mockMentionsFetch.mockResolvedValue({
            kind: 'mention',
            items: [makeItem({postId: 'p1', eventTs: NOW - 2000})],
            nextCursor: '1',
        });
        mockDmGmFetch.mockResolvedValue({
            kind: 'dm',
            items: [makeItem({eventKind: 'dm', postId: 'p2', eventTs: NOW - 1000})],
        });

        const service = new ActivityAggregationService();
        const page = await service.loadInitial({serverId: 'server-1', userId: 'user-1', nowMs: NOW});

        expect(page.items.map((item) => item.postId)).toEqual(['p2', 'p1']);
        expect(page.items[0].canonicalId).toBe('dm:post:p2');
        expect(page.checkpoint).toEqual({
            watermarkTs: NOW - 2000,
            mergeSequence: 1,
            visibleSinceMs: NOW - WEEK_MS,
        });
        expect(page.sourceCursors).toEqual({mention: '1'});
        expect(page.hasMore).toBe(true);

        const stored = service.getState('server-1');
        expect(stored?.items).toHaveLength(2);
        expect(window.localStorage.getItem('mm-webapp-activity-state:server-1')).toEqual(expect.any(String));
    });

    test('loadInitial hides items older than the visible window', async () => {
        mockMentionsFetch.mockResolvedValue({
            kind: 'mention',
            items: [makeItem({postId: 'old', eventTs: NOW - (WEEK_MS * 2)})],
        });

        const page = await new ActivityAggregationService().loadInitial({
            serverId: 'server-1',
            userId: 'user-1',
            nowMs: NOW,
        });

        expect(page.items).toEqual([]);
        expect(page.hasMore).toBe(true);
    });

    test('loadInitial collects per-source errors without failing the page', async () => {
        mockRemindersFetch.mockResolvedValue({kind: 'reminder', items: [], error: 'reminders down'});

        const page = await new ActivityAggregationService().loadInitial({
            serverId: 'server-1',
            userId: 'user-1',
            nowMs: NOW,
        });

        expect(page.errors).toEqual([{source: 'reminder', message: 'reminders down', retriable: true}]);
    });

    test('loadOlder widens the window and keeps previously loaded items', async () => {
        const olderItem = makeItem({postId: 'old', eventTs: NOW - (WEEK_MS + 1000)});
        const state: PersistedActivityState = {
            serverId: 'server-1',
            fetchedAt: NOW,
            uiCursor: String(NOW),
            sourceCursors: {mention: '1'},
            checkpoint: {watermarkTs: NOW - 1000, mergeSequence: 1, visibleSinceMs: NOW - WEEK_MS},
            items: [makeItem({postId: 'p1', eventTs: NOW - 1000, canonicalId: 'mention:post:p1'})],
        };
        mockMentionsFetch.mockResolvedValue({kind: 'mention', items: [olderItem]});

        const page = await new ActivityAggregationService().loadOlder(
            {serverId: 'server-1', userId: 'user-1', nowMs: NOW},
            state,
        );

        expect(mockMentionsFetch).toHaveBeenCalledWith(expect.objectContaining({page: 1, sinceMs: NOW - (2 * WEEK_MS)}));
        expect(page.items.map((item) => item.postId)).toEqual(['p1', 'old']);
        expect(page.checkpoint.visibleSinceMs).toBe(NOW - (2 * WEEK_MS));
        expect(page.checkpoint.mergeSequence).toBe(2);
    });

    test('refresh reuses the previous visible window', async () => {
        const state: PersistedActivityState = {
            serverId: 'server-1',
            fetchedAt: NOW,
            sourceCursors: {},
            checkpoint: {watermarkTs: 0, mergeSequence: 3, visibleSinceMs: NOW - (4 * WEEK_MS)},
            items: [],
        };

        const page = await new ActivityAggregationService().refresh(
            {serverId: 'server-1', userId: 'user-1', nowMs: NOW},
            state,
        );

        expect(page.checkpoint.visibleSinceMs).toBe(NOW - (4 * WEEK_MS));
        expect(page.checkpoint.mergeSequence).toBe(4);
        expect(mockMentionsFetch).toHaveBeenCalledWith(expect.objectContaining({page: 0}));
    });

    test('getState reads persisted state from local storage on a fresh service', async () => {
        const service = new ActivityAggregationService();
        mockMentionsFetch.mockResolvedValue({kind: 'mention', items: [makeItem({postId: 'p1'})]});
        await service.loadInitial({serverId: 'server-1', userId: 'user-1', nowMs: NOW});

        const reloaded = new ActivityAggregationService();
        expect(reloaded.getState('server-1')?.items.map((item) => item.postId)).toEqual(['p1']);
        expect(reloaded.getState('missing-server')).toBeNull();
    });

    test('getState returns null when the stored payload is corrupt', () => {
        window.localStorage.setItem('mm-webapp-activity-state:server-1', 'not-json');

        expect(new ActivityAggregationService().getState('server-1')).toBeNull();
    });

    test('searchLocal hydrates avatars and filters by query', () => {
        const service = new ActivityAggregationService();
        const items = [
            makeItem({postId: 'p1', previewText: 'hello world', actorUserId: 'actor-1'}),
            makeItem({postId: 'p2', previewText: 'other', actorAvatarUrl: '/custom.png', actorUserId: 'actor-2'}),
        ];

        const all = service.searchLocal('  ', items);
        expect(all[0].actorAvatarUrl).toBe('/api/v4/users/actor-1/image');
        expect(all[1].actorAvatarUrl).toBe('/custom.png');

        expect(service.searchLocal('WORLD', items).map((item) => item.postId)).toEqual(['p1']);
        expect(service.searchLocal('p2', items).map((item) => item.postId)).toEqual(['p2']);
        expect(service.searchLocal('nothing', items)).toEqual([]);
    });
});
