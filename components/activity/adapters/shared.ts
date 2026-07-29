// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';
import type {ChannelRecord, UserRecord} from '../records';
import {getPostsFromPayload, toRecordArray} from '../records';
import {fetchJSON, fetchJSONCached, postJSON} from '../api';
import {replaceMentionUsernamesWithDisplayNames} from '../mentionDisplay';

import type {AdapterFetchParams} from './types';

export type PostSearchResult = {
    posts: Array<Record<string, unknown>>;
    error?: string;
};

export const MIN_SEARCH_PER_PAGE = 10;
export const MAX_SEARCH_PER_PAGE = 100;

export function clampSearchPerPage(pageSize: number): number {
    return Math.max(MIN_SEARCH_PER_PAGE, Math.min(pageSize, MAX_SEARCH_PER_PAGE));
}

export async function getTeamIds(): Promise<string[]> {
    const response = await fetchJSON('/api/v4/users/me/teams');
    if (!response.ok) {
        return [];
    }

    return toRecordArray(response.data).
        map((team) => String(team.id || '')).
        filter(Boolean);
}

export function buildPostSearchBody(options: {
    terms: string;
    page: number;
    perPage: number;
    searchMentions?: boolean;
}): Record<string, unknown> {
    const body: Record<string, unknown> = {
        terms: options.terms,
        is_or_search: true,
        include_deleted_channels: true,
        time_zone_offset: -new Date().getTimezoneOffset() * 60,
        page: options.page,
        per_page: options.perPage,
    };
    if (options.searchMentions) {
        body.search_mentions = true;
    }
    return body;
}

export function mergePostSearchResults(...results: PostSearchResult[]): PostSearchResult {
    const postsById = new Map<string, Record<string, unknown>>();
    let firstError: string | undefined;

    results.forEach((result) => {
        if (!firstError && result.error) {
            firstError = result.error;
        }
        result.posts.forEach((post) => {
            const postId = String(post.id || '');
            if (postId) {
                postsById.set(postId, post);
            }
        });
    });

    const posts = Array.from(postsById.values());
    return {
        posts,
        error: posts.length ? undefined : firstError,
    };
}

/**
 * Runs a global post search and, when it fails and fan-out is allowed, retries the
 * same body against every team the user belongs to.
 */
export async function searchPosts(body: Record<string, unknown>, allowTeamFanOut: boolean): Promise<PostSearchResult> {
    const globalResponse = await postJSON('/api/v4/posts/search', body);
    if (globalResponse.ok) {
        return {posts: getPostsFromPayload(globalResponse.data)};
    }

    // Fan-out across every team freezes the UI on large orgs, so callers opt in.
    if (!allowTeamFanOut) {
        return {posts: [], error: globalResponse.error};
    }

    const teamIds = await getTeamIds();
    const responses = await Promise.all(teamIds.map((teamId) => (
        postJSON(`/api/v4/teams/${encodeURIComponent(teamId)}/posts/search`, body)
    )));

    const merged = mergePostSearchResults(...responses.map((response) => ({
        posts: response.ok ? getPostsFromPayload(response.data) : [],
    })));

    const error = globalResponse.error || responses.find((response) => response.error)?.error;
    if (!merged.posts.length && error) {
        return {posts: [], error};
    }

    return {posts: merged.posts};
}

export async function loadChannelsById(): Promise<Map<string, ChannelRecord>> {
    const channelsById = new Map<string, ChannelRecord>();
    const response = await fetchJSONCached('/api/v4/users/me/channels');
    if (!response.ok) {
        return channelsById;
    }

    toRecordArray(response.data).forEach((entry) => {
        const channelId = String(entry.id || '');
        if (!channelId) {
            return;
        }
        channelsById.set(channelId, {
            id: channelId,
            display_name: String(entry.display_name || ''),
            name: String(entry.name || ''),
            type: String(entry.type || ''),
        });
    });

    return channelsById;
}

export async function loadUsersById(userIds: string[]): Promise<Map<string, UserRecord>> {
    const usersById = new Map<string, UserRecord>();
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));

    await Promise.all(uniqueIds.map(async (userId) => {
        const response = await fetchJSONCached(`/api/v4/users/${encodeURIComponent(userId)}`);
        if (response.ok && response.data && typeof response.data === 'object') {
            usersById.set(userId, response.data as UserRecord);
        }
    }));

    return usersById;
}

/**
 * Rewrites @username mentions in the preview to display names and records the
 * personal/broadcast mention flags the UI uses for highlighting.
 */
export async function applyMentionRender(
    item: ActivityItem,
    serverId: string,
    mentionNameCache: Map<string, string | null>,
    selfUsername: string,
): Promise<ActivityItem> {
    const mentionRender = await replaceMentionUsernamesWithDisplayNames(
        serverId,
        item.previewText,
        mentionNameCache,
        selfUsername,
    );

    item.previewText = mentionRender.text;
    item.sourceRef = {
        ...(item.sourceRef || {}),
        personalMention: mentionRender.hasPersonalMention ? 'true' : '',
        broadcastMention: mentionRender.hasBroadcastMention ? 'true' : '',
    };
    return item;
}

export function filterItemsByWindow(items: ActivityItem[], params: AdapterFetchParams): ActivityItem[] {
    return items.
        filter((item) => item.eventTs >= params.sinceMs).
        filter((item) => !params.beforeMs || item.eventTs < params.beforeMs);
}
