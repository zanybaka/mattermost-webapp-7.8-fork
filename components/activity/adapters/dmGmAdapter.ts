// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import type {ChannelRecord, PostRecord, UserRecord} from '../records';
import {formatUserDisplayName, getPostsFromPayload, toRecordArray} from '../records';
import {fetchJSON, getUserAvatarURL} from '../api';
import {forEachWithConcurrency} from '../concurrency';
import {getCurrentUserUsername, hasBroadcastMention, hasPersonalMention} from '../mentionDisplay';

import {filterItemsByWindow} from './shared';
import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';

// Feature toggle: hide own DM/GM messages from Activity feed.
const HIDE_MESSAGES_FROM_ME = true;
const MAX_DM_GM_CHANNELS_PER_REFRESH = 10;
const MAX_DM_GM_POSTS_PER_CHANNEL = 5;
const DM_GM_FETCH_CONCURRENCY = 4;
const HIDDEN_DM_SYSTEM_MESSAGE_PATTERNS = [
    /\bmarked\b.*\bas complete\b/i,
];

type DirectChannelRecord = ChannelRecord & {type: string};

function normalizeMessageForComparison(message: string): string {
    return message.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isHiddenReminderCompletionDMMessage(post: PostRecord, channelType: string): boolean {
    if (channelType !== 'D') {
        return false;
    }

    const normalizedMessage = normalizeMessageForComparison(post.message || '');
    return HIDDEN_DM_SYSTEM_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

function getChannelActivityTs(channel: DirectChannelRecord): number {
    return Number(channel.last_post_at || channel.update_at || 0);
}

function getPostActivityTs(post: PostRecord): number {
    return Number(post.create_at || post.update_at || 0);
}

type NormalizedChannelPostActivityParams = {
    serverId: string;
    userId: string;
    channel: DirectChannelRecord;
    kind: 'dm' | 'gm';
    post: PostRecord;
    actorName: string;
    participantNames: string[];
};

async function fetchUserById(userId: string, userCache: Map<string, Promise<UserRecord | null>>) {
    if (!userId) {
        return null;
    }

    const cached = userCache.get(userId);
    if (cached) {
        return cached;
    }

    const request = (async () => {
        const response = await fetchJSON(`/api/v4/users/${encodeURIComponent(userId)}`);
        if (!response.ok || !response.data || typeof response.data !== 'object') {
            return null;
        }

        return response.data as UserRecord;
    })();
    userCache.set(userId, request);
    return request;
}

async function fetchChannelPosts(
    channelId: string,
    page: number,
    perPage: number,
): Promise<{posts: PostRecord[]; error?: string}> {
    const response = await fetchJSON(`/api/v4/channels/${encodeURIComponent(channelId)}/posts?page=${page}&per_page=${perPage}`);
    if (!response.ok) {
        return {posts: [], error: response.error};
    }

    return {
        posts: getPostsFromPayload(response.data).
            map((post) => ({...post, id: String(post.id || '')} as PostRecord)).
            filter((post) => Boolean(post.id)),
    };
}

function normalizeChannelPostActivity({
    serverId,
    userId,
    channel,
    kind,
    post,
    actorName,
    participantNames,
}: NormalizedChannelPostActivityParams): ActivityItem {
    const eventTs = Number(post.create_at || post.update_at || channel.last_post_at || channel.update_at || 0);
    const message = (post.message || '').trim();

    let previewText = '';
    if (kind === 'dm') {
        const dmPeer = participantNames[0] || channel.display_name || 'Direct message';
        if (message) {
            previewText = `${actorName || dmPeer}: ${message}`;
        } else {
            previewText = `Direct message with ${dmPeer}`;
        }
    } else if (message) {
        previewText = `${actorName || 'Member'}: ${message}`;
    } else {
        previewText = `Group message with ${participantNames.join(', ') || channel.display_name || channel.id}`;
    }

    const actorUserId = post.user_id;

    return {
        canonicalId: '',
        eventKind: kind,
        serverId,
        targetUserId: userId,
        eventTs,
        previewText,
        channelId: channel.id,
        postId: post.id,
        actorUserId,
        actorAvatarUrl: actorUserId ? getUserAvatarURL(actorUserId) : undefined,
        sourceRef: {
            channelId: channel.id,
            postId: post.id,
            actorName: actorName || '',
            groupMembers: participantNames.join(', '),
        },
    };
}

export class DMGMAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'dm';

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        const endpoint = '/api/v4/users/me/channels';
        const response = await fetchJSON(endpoint);
        if (!response.ok) {
            return {kind: this.kind, items: [], error: response.error};
        }

        const records = toRecordArray(response.data).
            filter((channel): channel is DirectChannelRecord => Boolean(channel.id && channel.type)).
            filter((channel) => channel.type === 'D' || channel.type === 'G').
            filter((channel) => getChannelActivityTs(channel) >= params.sinceMs).
            sort((a, b) => getChannelActivityTs(b) - getChannelActivityTs(a)).
            slice(0, MAX_DM_GM_CHANNELS_PER_REFRESH);

        const userCache = new Map<string, Promise<UserRecord | null>>();
        const selfUsername = await getCurrentUserUsername(params.serverId, params.userId);
        const items = [] as ActivityItem[];
        let hasMore = false;
        let firstChannelError: string | undefined;

        await forEachWithConcurrency(records, DM_GM_FETCH_CONCURRENCY, async (channel) => {
            const postsPerChannel = Math.min(params.pageSize, MAX_DM_GM_POSTS_PER_CHANNEL);
            const {posts, error} = await fetchChannelPosts(channel.id, params.page, postsPerChannel);
            if (error && !firstChannelError) {
                firstChannelError = error;
            }
            if (posts.length >= postsPerChannel) {
                hasMore = true;
            }

            const relevantPosts = posts.
                filter((post) => getPostActivityTs(post) >= params.sinceMs).
                filter((post) => !params.beforeMs || getPostActivityTs(post) < params.beforeMs).
                filter((post) => !HIDE_MESSAGES_FROM_ME || post.user_id !== params.userId).
                filter((post) => !isHiddenReminderCompletionDMMessage(post, channel.type));
            if (!relevantPosts.length) {
                return;
            }

            await Promise.all(relevantPosts.map(async (post) => {
                const actor = post.user_id ? await fetchUserById(post.user_id, userCache) : null;
                const actorName = formatUserDisplayName(actor || undefined);
                const message = post.message || '';
                const normalizedItem = normalizeChannelPostActivity({
                    serverId: params.serverId,
                    userId: params.userId,
                    channel,
                    kind: channel.type === 'D' ? 'dm' : 'gm',
                    post,
                    actorName,
                    participantNames: [],
                });
                normalizedItem.sourceRef = {
                    ...(normalizedItem.sourceRef || {}),
                    personalMention: hasPersonalMention(message, selfUsername) ? 'true' : '',
                    broadcastMention: hasBroadcastMention(message) ? 'true' : '',
                };
                items.push(normalizedItem);
            }));
        });

        const filteredItems = filterItemsByWindow(items, params);

        return {
            kind: this.kind,
            items: filteredItems,

            // Per-channel failures still surface so the feed can flag incomplete data.
            error: firstChannelError,
            nextCursor: hasMore ? String(params.page + 1) : undefined,
        };
    }
}

