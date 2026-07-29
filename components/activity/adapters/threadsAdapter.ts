// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import {formatChannelDisplayName, formatUserDisplayName, getObject, getString, toRecordArray} from '../records';
import {getCurrentUserUsername} from '../mentionDisplay';
import {fetchJSON, getUserAvatarURL} from '../api';

import {
    applyMentionRender,
    filterItemsByWindow,
    getTeamIds,
    loadChannelsById,
    loadUsersById,
} from './shared';
import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';

function extractThreads(payload: unknown): Array<Record<string, unknown>> {
    const typed = getObject(payload);
    return typed ? toRecordArray(typed.threads) : [];
}

function extractThreadSnippet(thread: Record<string, unknown>): string {
    const lastReplyText = getString(thread.last_reply_text).trim();
    if (lastReplyText) {
        return lastReplyText;
    }

    const postObject = getObject(thread.post);
    if (postObject) {
        const postMessage = getString(postObject.message).trim();
        if (postMessage) {
            return postMessage;
        }
    }

    const message = getString(thread.message).trim();
    if (message) {
        return message;
    }

    const postAsString = getString(thread.post).trim();
    if (postAsString) {
        return postAsString;
    }

    return '';
}

function extractThreadActorUserId(thread: Record<string, unknown>): string | undefined {
    const candidates = [
        getString(thread.last_reply_user_id),
        getString(thread.last_reply_by),
    ];

    const postObject = getObject(thread.post);
    if (postObject) {
        candidates.push(getString(postObject.user_id));
    }

    const resolved = candidates.map((value) => value.trim()).find(Boolean);
    return resolved || undefined;
}

function extractThreadChannelId(thread: Record<string, unknown>): string {
    const directChannelId = getString(thread.channel_id).trim();
    if (directChannelId) {
        return directChannelId;
    }

    const postObject = getObject(thread.post);
    if (postObject) {
        const postChannelId = getString(postObject.channel_id).trim();
        if (postChannelId) {
            return postChannelId;
        }
    }

    return '';
}

function extractThreadEventTs(thread: Record<string, unknown>): number {
    const postObject = getObject(thread.post);
    const candidates = [
        Number(thread.last_reply_at || 0),
        Number(postObject?.update_at || 0),
        Number(postObject?.create_at || 0),
        Number(thread.update_at || 0),
        Number(thread.create_at || 0),
    ];

    const resolved = candidates.find((value) => Number.isFinite(value) && value > 0);
    return resolved || Date.now();
}

function normalizeThreadReply(
    serverId: string,
    userId: string,
    thread: Record<string, unknown>,
    actorName = '',
    channelName = '',
): ActivityItem {
    const postId = String(thread.post_id || thread.id || '');
    const channelId = extractThreadChannelId(thread);
    const rootId = String(thread.id || thread.post_id || '');
    const eventTs = extractThreadEventTs(thread);
    const snippet = extractThreadSnippet(thread);
    const actorUserId = extractThreadActorUserId(thread);

    return {
        canonicalId: '',
        eventKind: 'thread_reply',
        serverId,
        targetUserId: userId,
        eventTs,
        previewText: snippet,
        postId: postId || undefined,
        channelId: channelId || undefined,
        threadId: rootId || undefined,
        actorUserId,
        actorAvatarUrl: actorUserId ? getUserAvatarURL(actorUserId) : undefined,
        sourceRef: {
            threadId: rootId,
            postId,
            channelId,
            actorName: actorName || '',
            channelName: channelName || '',
        },
    };
}

export class ThreadsAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'thread_reply';

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        const teamIds = await getTeamIds();
        const query = `deleted=false&page=${params.page}&per_page=${params.pageSize}&totalsOnly=false&extended=true&skipTotal=true&disable_channel_type_group=true`;
        const baseEndpoints = [
            `/api/v4/users/me/teams/threads?page=${params.page}&per_page=${params.pageSize}&extended=true`,
        ];
        const teamScopedEndpoints = teamIds.flatMap((teamId) => {
            const encodedTeamId = encodeURIComponent(teamId);
            const meEndpoint = `/api/v4/users/me/teams/${encodedTeamId}/threads?${query}`;
            const userEndpoint = params.userId ? `/api/v4/users/${encodeURIComponent(params.userId)}/teams/${encodedTeamId}/threads?${query}` : '';
            return [userEndpoint, meEndpoint].filter(Boolean);
        });
        const endpoints = [...baseEndpoints, ...teamScopedEndpoints];

        let collected: Array<Record<string, unknown>> = [];
        let lastError = '';

        for (const endpoint of endpoints) {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetchJSON(endpoint);
            if (!response.ok) {
                lastError = response.error || lastError;
                continue;
            }

            const threads = extractThreads(response.data);
            if (threads.length) {
                collected = collected.concat(threads);
            }
        }

        if (!collected.length && lastError) {
            return {kind: this.kind, items: [], error: lastError};
        }

        const channelsMap = await loadChannelsById();
        const userMap = await loadUsersById(collected.
            map((thread) => extractThreadActorUserId(thread)).
            filter((id): id is string => Boolean(id)));

        const mentionNameCache = new Map<string, string | null>();
        const selfUsername = await getCurrentUserUsername(params.serverId, params.userId);
        const items = await Promise.all(collected.map(async (thread) => {
            const actorId = extractThreadActorUserId(thread);
            const channelId = extractThreadChannelId(thread);
            const normalized = normalizeThreadReply(
                params.serverId,
                params.userId,
                thread,
                formatUserDisplayName(actorId ? userMap.get(actorId) : undefined),
                formatChannelDisplayName(channelsMap.get(channelId)),
            );
            return applyMentionRender(normalized, params.serverId, mentionNameCache, selfUsername);
        }));

        const filteredItems = filterItemsByWindow(
            items.filter((item) => item.actorUserId !== params.userId),
            params,
        );

        return {
            kind: this.kind,
            items: filteredItems,
            nextCursor: String(params.page + 1),
        };
    }
}

