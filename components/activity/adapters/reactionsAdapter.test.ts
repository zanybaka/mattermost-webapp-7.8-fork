// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON, fetchJSONCached, postJSON} from '../api';
import {getCurrentUserUsername} from '../mentionDisplay';

import {ReactionsAdapter} from './reactionsAdapter';
import type {AdapterFetchParams} from './types';

jest.mock('../api', () => ({
    fetchJSON: jest.fn(),
    fetchJSONCached: jest.fn(),
    postJSON: jest.fn(),
    getEmojiImageURL: (id: string) => `/api/v4/emoji/${id}/image`,
    getUserAvatarURL: (id: string) => `/api/v4/users/${id}/image`,
}));

jest.mock('../mentionDisplay', () => ({
    getCurrentUserUsername: jest.fn(),
}));

const fetchJSONMock = fetchJSON as jest.MockedFunction<typeof fetchJSON>;
const fetchJSONCachedMock = fetchJSONCached as jest.MockedFunction<typeof fetchJSONCached>;
const postJSONMock = postJSON as jest.MockedFunction<typeof postJSON>;
const getCurrentUserUsernameMock = getCurrentUserUsername as jest.MockedFunction<typeof getCurrentUserUsername>;

function makeParams(overrides: Partial<AdapterFetchParams> = {}): AdapterFetchParams {
    return {
        serverId: 'server-1',
        userId: 'me',
        pageSize: 30,
        page: 0,
        sinceMs: 0,
        ...overrides,
    };
}

function searchPayload(posts: Array<Record<string, unknown>>) {
    return {
        ok: true,
        data: {
            order: posts.map((post) => post.id),
            posts: Object.fromEntries(posts.map((post) => [post.id, post])),
        },
    };
}

describe('ReactionsAdapter', () => {
    beforeEach(() => {
        getCurrentUserUsernameMock.mockResolvedValue('me-username');
        fetchJSONCachedMock.mockResolvedValue({ok: false, error: 'no custom emoji'});
    });

    test('returns nothing without a user id', async () => {
        const result = await new ReactionsAdapter().fetch(makeParams({userId: ''}));

        expect(result).toEqual({kind: 'reaction', items: [], nextCursor: undefined});
        expect(postJSONMock).not.toHaveBeenCalled();
    });

    test('errors when the username cannot be resolved', async () => {
        getCurrentUserUsernameMock.mockResolvedValue('');

        const result = await new ReactionsAdapter().fetch(makeParams());

        expect(result).toEqual({kind: 'reaction', items: [], error: 'failed to resolve current username'});
    });

    test('builds reaction items from reactions on the user own posts', async () => {
        postJSONMock.mockResolvedValue(searchPayload([{
            id: 'post-1',
            user_id: 'me',
            channel_id: 'channel-1',
            metadata: {
                reactions: [
                    {user_id: 'other', emoji_name: 'smile', create_at: 500, post_id: 'post-1'},
                    {user_id: 'me', emoji_name: 'wave', create_at: 500},
                    null,
                ],
            },
        }, {
            id: 'post-2',
            user_id: 'someone-else',
            metadata: {reactions: [{user_id: 'other', emoji_name: 'tada', create_at: 600}]},
        }]));

        const result = await new ReactionsAdapter().fetch(makeParams());

        expect(postJSONMock).toHaveBeenCalledWith('/api/v4/posts/search', expect.objectContaining({
            terms: 'from:me-username after:1970-01-01',
            is_or_search: true,
            per_page: 100,
        }));
        expect(result.items).toEqual([expect.objectContaining({
            eventKind: 'reaction',
            postId: 'post-1',
            channelId: 'channel-1',
            actorUserId: 'other',
            actorAvatarUrl: '/api/v4/users/other/image',
            eventTs: 500,
            previewText: ':smile:',
            isUnread: true,
            sourceRef: {postId: 'post-1', emoji: 'smile', emojiImageUrl: '', channelId: 'channel-1'},
        })]);
    });

    test('attaches custom emoji image urls', async () => {
        postJSONMock.mockResolvedValue(searchPayload([{
            id: 'post-1',
            user_id: 'me',
            metadata: {reactions: [{user_id: 'other', emoji_name: 'party_parrot', create_at: 500}]},
        }]));
        fetchJSONCachedMock.mockResolvedValue({ok: true, data: {id: 'emoji-1'}});

        const result = await new ReactionsAdapter().fetch(makeParams());

        expect(fetchJSONCachedMock).toHaveBeenCalledWith('/api/v4/emoji/name/party_parrot');
        expect(result.items[0].sourceRef?.emojiImageUrl).toBe('/api/v4/emoji/emoji-1/image');
    });

    test('falls back to per-team search when the global search fails', async () => {
        postJSONMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/posts/search') {
                return {ok: false, error: 'request failed with status 501'};
            }
            return searchPayload([{
                id: 'post-1',
                user_id: 'me',
                metadata: {reactions: [{user_id: 'other', emoji_name: 'smile', create_at: 500}]},
            }]);
        });
        fetchJSONMock.mockResolvedValue({ok: true, data: [{id: 'team-1'}, {}, null]});

        const result = await new ReactionsAdapter().fetch(makeParams());

        expect(fetchJSONMock).toHaveBeenCalledWith('/api/v4/users/me/teams');
        expect(postJSONMock).toHaveBeenCalledWith('/api/v4/teams/team-1/posts/search', expect.any(Object));
        expect(result.items).toHaveLength(1);
    });

    test('reports the search error when nothing could be fetched', async () => {
        postJSONMock.mockResolvedValue({ok: false, error: 'request failed with status 500'});
        fetchJSONMock.mockResolvedValue({ok: false, error: 'boom'});

        const result = await new ReactionsAdapter().fetch(makeParams());

        expect(result).toEqual({kind: 'reaction', items: [], error: 'request failed with status 500'});
    });

    test('filters reactions outside the requested window and sorts newest first', async () => {
        postJSONMock.mockResolvedValue(searchPayload([{
            id: 'post-1',
            user_id: 'me',
            metadata: {
                reactions: [
                    {user_id: 'a', emoji_name: 'one', create_at: 50},
                    {user_id: 'b', emoji_name: 'two', create_at: 150},
                    {user_id: 'c', emoji_name: 'three', create_at: 180},
                    {user_id: 'c', emoji_name: 'three', create_at: 180},
                    {user_id: 'd', emoji_name: 'four', create_at: 500},
                ],
            },
        }]));

        const result = await new ReactionsAdapter().fetch(makeParams({sinceMs: 100, beforeMs: 200}));

        expect(result.items.map((item) => item.previewText)).toEqual([':three:', ':two:']);
    });
});
