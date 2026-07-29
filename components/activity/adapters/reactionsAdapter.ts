// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import {toRecordArray} from '../records';

import {fetchJSONCached, getEmojiImageURL, getUserAvatarURL} from '../api';

import {getCurrentUserUsername} from '../mentionDisplay';

import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';
import type {PostSearchResult} from './shared';
import {buildPostSearchBody, filterItemsByWindow, searchPosts} from './shared';

const MAX_SEARCH_PAGES = 10;
const SEARCH_PER_PAGE = 100;

function extractReactions(post: Record<string, unknown>): Array<Record<string, unknown>> {
    const metadata = post.metadata;
    if (!metadata || typeof metadata !== 'object') {
        return [];
    }

    return toRecordArray((metadata as Record<string, unknown>).reactions);
}

function formatSearchAfterDate(sinceMs: number): string {
    const date = new Date(Math.max(0, sinceMs));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function searchOwnPostsPage(terms: string, page: number): Promise<PostSearchResult> {
    const body = buildPostSearchBody({terms, page, perPage: SEARCH_PER_PAGE});
    return searchPosts(body, true);
}

async function resolveCustomEmojiImageUrls(emojiNames: string[]): Promise<Map<string, string>> {
    const urlsByName = new Map<string, string>();
    await Promise.all(emojiNames.map(async (emojiName) => {
        const endpoint = `/api/v4/emoji/name/${encodeURIComponent(emojiName)}`;
        const response = await fetchJSONCached(endpoint);
        if (!response.ok || !response.data || typeof response.data !== 'object') {
            return;
        }

        const emojiId = String((response.data as Record<string, unknown>).id || '').trim();
        if (emojiId) {
            urlsByName.set(emojiName, getEmojiImageURL(emojiId));
        }
    }));

    return urlsByName;
}

function normalizeReaction(
    serverId: string,
    userId: string,
    reaction: Record<string, unknown>,
    emojiImageUrlsByName: Map<string, string>,
    channelId = '',
): ActivityItem {
    const postId = String(reaction.post_id || '');
    const createAt = Number(reaction.create_at || Date.now());
    const actor = String(reaction.user_id || '');
    const actorUserId = actor || undefined;
    const emoji = String(reaction.emoji_name || '').trim() || 'reaction';
    const emojiImageUrl = emojiImageUrlsByName.get(emoji);

    return {
        canonicalId: '',
        eventKind: 'reaction',
        serverId,
        targetUserId: userId,
        eventTs: createAt,
        previewText: `:${emoji}:`,
        postId: postId || undefined,
        channelId: channelId || undefined,
        actorUserId,
        actorAvatarUrl: actorUserId ? getUserAvatarURL(actorUserId) : undefined,
        isUnread: true,
        sourceRef: {
            postId,
            emoji,
            emojiImageUrl: emojiImageUrl || '',
            channelId: channelId || '',
        },
    };
}

export class ReactionsAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'reaction';

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        if (!params.userId) {
            return {kind: this.kind, items: [], nextCursor: undefined};
        }

        const username = await getCurrentUserUsername(params.serverId, params.userId);
        if (!username) {
            return {kind: this.kind, items: [], error: 'failed to resolve current username'};
        }

        const terms = `from:${username} after:${formatSearchAfterDate(params.sinceMs)}`;
        const postsById = new Map<string, Record<string, unknown>>();
        let firstError: string | undefined;

        for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
            // eslint-disable-next-line no-await-in-loop
            const pageResult = await searchOwnPostsPage(terms, page);
            if (pageResult.error && !firstError) {
                firstError = pageResult.error;
            }

            let newCount = 0;
            pageResult.posts.forEach((post) => {
                const postId = String(post.id || '');
                if (!postId || postsById.has(postId)) {
                    return;
                }
                postsById.set(postId, post);
                newCount += 1;
            });

            if (pageResult.posts.length < SEARCH_PER_PAGE || newCount === 0) {
                break;
            }
        }

        if (!postsById.size && firstError) {
            return {kind: this.kind, items: [], error: firstError};
        }

        const reactions = [] as Array<Record<string, unknown> & {channel_id?: string}>;
        for (const post of postsById.values()) {
            const postId = String(post.id || '');
            const postAuthorId = String(post.user_id || '');
            if (postAuthorId !== params.userId) {
                continue;
            }

            const channelId = String(post.channel_id || '');
            for (const reaction of extractReactions(post)) {
                const reactionUserId = String(reaction.user_id || '');
                if (!reactionUserId || reactionUserId === params.userId) {
                    continue;
                }

                reactions.push({
                    ...reaction,
                    post_id: String(reaction.post_id || postId),
                    channel_id: channelId,
                });
            }
        }

        const seen = new Set<string>();
        const emojiNames = Array.from(new Set(
            reactions.
                map((reaction) => String(reaction.emoji_name || '').trim()).
                filter(Boolean),
        ));
        const emojiImageUrlsByName = await resolveCustomEmojiImageUrls(emojiNames);
        const normalizedItems = reactions.
            map((reaction) => normalizeReaction(
                params.serverId,
                params.userId,
                reaction,
                emojiImageUrlsByName,
                String(reaction.channel_id || ''),
            )).
            filter((item) => {
                const key = `${item.postId || ''}:${item.actorUserId || ''}:${item.sourceRef?.emoji || ''}:${item.eventTs}`;
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
        const items = filterItemsByWindow(normalizedItems, params).
            sort((a, b) => b.eventTs - a.eventTs);

        return {
            kind: this.kind,
            items,

            // Partial search failures still surface so the feed can flag stale data.
            error: firstError,
            nextCursor: undefined,
        };
    }
}

