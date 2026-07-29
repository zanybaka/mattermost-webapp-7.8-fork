// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import type {UserRecord} from '../records';
import {formatChannelDisplayName, formatUserDisplayName, getString} from '../records';
import {fetchJSONCached, getUserAvatarURL} from '../api';
import {getCurrentUserUsername} from '../mentionDisplay';

import type {PostSearchResult} from './shared';
import {
    applyMentionRender,
    buildPostSearchBody,
    clampSearchPerPage,
    filterItemsByWindow,
    loadChannelsById,
    loadUsersById,
    mergePostSearchResults,
    searchPosts,
} from './shared';
import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';

type MentionSearchOptions = {
    useSearchMentions: boolean;
    terms: string;
    skipTeamFanOut?: boolean;
};

function buildMentionSearchTerms(user: UserRecord): string {
    const keys: string[] = [];
    const username = (user.username || '').trim();
    if (username) {
        keys.push(`@${username}`);
    }

    const notifyProps = user.notify_props || {};
    if (notifyProps.first_name === 'true' && user.first_name?.trim()) {
        keys.push(user.first_name.trim());
    }

    const mentionKeys = (notifyProps.mention_keys || '').
        split(',').
        map((key) => key.trim()).
        filter(Boolean);
    for (const key of mentionKeys) {
        const normalized = key.toLowerCase();
        if (normalized === '@channel' || normalized === '@all' || normalized === '@here' ||
            normalized === 'channel' || normalized === 'all' || normalized === 'here') {
            continue;
        }
        keys.push(key.startsWith('@') ? key : `@${key}`);
    }

    const uniqueKeys = Array.from(new Set(keys));
    return uniqueKeys.map((key) => `"${key}"`).join(' ');
}

async function searchMentionPosts(
    params: AdapterFetchParams,
    options: MentionSearchOptions,
): Promise<PostSearchResult> {
    const body = buildPostSearchBody({
        terms: options.terms,
        page: params.page,
        perPage: clampSearchPerPage(params.pageSize),
        searchMentions: options.useSearchMentions,
    });

    // Supplemental queries skip the per-team fan-out — it freezes the UI on large orgs.
    const allowTeamFanOut = !options.useSearchMentions && !options.skipTeamFanOut;
    return searchPosts(body, allowTeamFanOut);
}

async function searchMentionQueries(params: AdapterFetchParams, queries: string[]): Promise<PostSearchResult> {
    const results = await Promise.all(queries.map((terms) => (
        searchMentionPosts(params, {useSearchMentions: false, terms, skipTeamFanOut: true})
    )));
    return mergePostSearchResults(...results);
}

async function searchBroadcastMentionPosts(params: AdapterFetchParams): Promise<PostSearchResult> {
    // Time often omits these from search_mentions; query them explicitly without team fan-out.
    return searchMentionQueries(params, ['"@channel"', '"@all"', '"@here"']);
}

async function searchFallbackMentionPosts(params: AdapterFetchParams, user: UserRecord): Promise<PostSearchResult> {
    const queries = [
        buildMentionSearchTerms(user),
        ...(user.notify_props?.channel === 'true' ? ['"@channel"', '"@all"', '"@here"'] : []),
    ].filter(Boolean);

    return searchMentionQueries(params, queries);
}

function extractMentionPreview(post: Record<string, unknown>): string {
    const message = getString(post.message).trim();
    if (message) {
        return message;
    }

    const props = (post.props && typeof post.props === 'object') ? post.props as Record<string, unknown> : undefined;
    if (props) {
        const directLink = getString(props.permalink) || getString(props.link) || getString(props.url);
        if (directLink) {
            return directLink;
        }

        const attachments = Array.isArray(props.attachments) ? props.attachments : [];
        for (const attachment of attachments) {
            if (!attachment || typeof attachment !== 'object') {
                continue;
            }
            const typedAttachment = attachment as Record<string, unknown>;
            const candidate = getString(typedAttachment.original_url) || getString(typedAttachment.title_link) || getString(typedAttachment.url);
            if (candidate) {
                return candidate;
            }
        }
    }

    const metadata = (post.metadata && typeof post.metadata === 'object') ? post.metadata as Record<string, unknown> : undefined;
    const embeds = (metadata && Array.isArray(metadata.embeds)) ? metadata.embeds : [];
    for (const embed of embeds) {
        if (!embed || typeof embed !== 'object') {
            continue;
        }
        const typedEmbed = embed as Record<string, unknown>;
        const candidate = getString(typedEmbed.url);
        if (candidate) {
            return candidate;
        }
    }

    return '';
}

function normalizeMention(serverId: string, userId: string, post: Record<string, unknown>, actorName = '', channelName = ''): ActivityItem {
    const postId = String(post.id || '');
    const eventTs = Number(post.create_at || post.update_at || Date.now());
    const previewText = extractMentionPreview(post);
    const channelId = String(post.channel_id || '');
    const rootId = String(post.root_id || '');
    const user = String(post.user_id || '');
    const actorUserId = user || undefined;

    return {
        canonicalId: '',
        eventKind: 'mention',
        serverId,
        targetUserId: userId,
        eventTs,
        previewText,
        postId,
        channelId: channelId || undefined,
        threadId: rootId || undefined,
        actorUserId,
        actorAvatarUrl: actorUserId ? getUserAvatarURL(actorUserId) : undefined,
        isUnread: true,
        sourceRef: {
            postId,
            channelId,
            actorName: actorName || '',
            channelName: channelName || '',
            linkUrl: previewText.startsWith('http://') || previewText.startsWith('https://') ? previewText : '',
        },
    };
}

async function fetchMentionPosts(params: AdapterFetchParams): Promise<{items: ActivityItem[]; error?: string}> {
    if (!params.userId) {
        return {items: []};
    }

    // Mattermost 7.8 / older search: search_mentions often returns personal hits but misses @all/@channel/@here.
    // Merge lightweight broadcast-only queries (no per-team fan-out) so the UI stays responsive.
    const primaryResult = await searchMentionPosts(params, {useSearchMentions: true, terms: ''});
    const broadcastResult = await searchBroadcastMentionPosts(params);
    let searchResult = mergePostSearchResults(primaryResult, broadcastResult);

    if (!searchResult.posts.length) {
        const userResponse = await fetchJSONCached(`/api/v4/users/${encodeURIComponent(params.userId)}`);
        let user: UserRecord | undefined;
        if (userResponse.ok && userResponse.data && typeof userResponse.data === 'object') {
            user = userResponse.data as UserRecord;
        }
        if (user) {
            searchResult = await searchFallbackMentionPosts(params, user);
        }
    }

    const {posts, error} = searchResult;
    if (!posts.length) {
        return {items: [], error};
    }

    const channelsById = await loadChannelsById();
    const mentionNameCache = new Map<string, string | null>();
    const selfUsername = await getCurrentUserUsername(params.serverId, params.userId);
    const userMap = await loadUsersById(posts.map((post) => String(post.user_id || '')));

    const seen = new Set<string>();
    const normalizedItems = await Promise.all(posts.
        filter((post) => {
            const channelId = String(post.channel_id || '');
            const channel = channelsById.get(channelId);
            return channel?.type !== 'D';
        }).
        map(async (post) => {
            const actorId = String(post.user_id || '');
            const channelId = String(post.channel_id || '');
            const normalized = normalizeMention(
                params.serverId,
                params.userId,
                post,
                formatUserDisplayName(userMap.get(actorId)),
                formatChannelDisplayName(channelsById.get(channelId)),
            );
            return applyMentionRender(normalized, params.serverId, mentionNameCache, selfUsername);
        }));

    const deduped = normalizedItems.
        filter((item) => {
            if (!item.postId || seen.has(item.postId)) {
                return false;
            }
            seen.add(item.postId);
            return true;
        }).
        filter((item) => item.actorUserId !== params.userId);
    const items = filterItemsByWindow(deduped, params);

    return {items, error};
}

export class MentionsAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'mention';

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        const {items, error} = await fetchMentionPosts(params);
        const perPage = clampSearchPerPage(params.pageSize);
        return {
            kind: this.kind,
            items,
            nextCursor: items.length >= perPage ? String(params.page + 1) : undefined,
            error,
        };
    }
}

