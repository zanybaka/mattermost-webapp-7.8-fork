// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON} from '../api';
import {getCurrentUserUsername} from '../mentionDisplay';

import {DMGMAdapter} from './dmGmAdapter';
import type {AdapterFetchParams} from './types';

jest.mock('../api', () => ({
    fetchJSON: jest.fn(),
    getUserAvatarURL: (id: string) => `/api/v4/users/${id}/image`,
}));

jest.mock('../mentionDisplay', () => ({
    getCurrentUserUsername: jest.fn(),
}));

const fetchJSONMock = fetchJSON as jest.MockedFunction<typeof fetchJSON>;
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

type Route = {channels?: unknown; posts?: Record<string, unknown[]>; users?: Record<string, unknown>};

function routeFetch({channels = [], posts = {}, users = {}}: Route) {
    fetchJSONMock.mockImplementation(async (path: string) => {
        if (path === '/api/v4/users/me/channels') {
            return {ok: true, data: channels};
        }

        const postsMatch = (/^\/api\/v4\/channels\/([^/]+)\/posts/).exec(path);
        if (postsMatch) {
            const channelPosts = posts[decodeURIComponent(postsMatch[1])] || [];
            return {
                ok: true,
                data: {
                    order: channelPosts.map((post) => (post as {id: string}).id),
                    posts: Object.fromEntries(channelPosts.map((post) => [(post as {id: string}).id, post])),
                },
            };
        }

        const userMatch = (/^\/api\/v4\/users\/([^/?]+)$/).exec(path);
        if (userMatch) {
            const user = users[decodeURIComponent(userMatch[1])];
            return user ? {ok: true, data: user} : {ok: false, error: 'request failed with status 404'};
        }

        return {ok: false, error: `unexpected path ${path}`};
    });
}

describe('DMGMAdapter', () => {
    beforeEach(() => {
        getCurrentUserUsernameMock.mockResolvedValue('me-username');
    });

    test('propagates the channel listing error', async () => {
        fetchJSONMock.mockResolvedValue({ok: false, error: 'request failed with status 500'});

        const result = await new DMGMAdapter().fetch(makeParams());

        expect(result).toEqual({kind: 'dm', items: [], error: 'request failed with status 500'});
    });

    test('builds dm items with the actor display name as a preview prefix', async () => {
        routeFetch({
            channels: [
                {id: 'dm-1', type: 'D', last_post_at: 500, display_name: 'Bob'},
                {id: 'open-1', type: 'O', last_post_at: 900},
                null,
            ],
            posts: {'dm-1': [{id: 'post-1', user_id: 'bob', message: 'hello @me-username', create_at: 500}]},
            users: {bob: {id: 'bob', first_name: 'Bob', last_name: 'Ross'}},
        });

        const result = await new DMGMAdapter().fetch(makeParams());

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            eventKind: 'dm',
            channelId: 'dm-1',
            postId: 'post-1',
            actorUserId: 'bob',
            actorAvatarUrl: '/api/v4/users/bob/image',
            previewText: 'Bob Ross: hello @me-username',
        });
        expect(result.items[0].sourceRef).toMatchObject({
            actorName: 'Bob Ross',
            personalMention: 'true',
            broadcastMention: '',
        });
        expect(result.nextCursor).toBeUndefined();
    });

    test('flags broadcast mentions in group messages and falls back to Member', async () => {
        routeFetch({
            channels: [{id: 'gm-1', type: 'G', update_at: 400}],
            posts: {'gm-1': [{id: 'post-1', user_id: 'ghost', message: 'ping @channel', create_at: 400}]},
        });

        const result = await new DMGMAdapter().fetch(makeParams());

        expect(result.items[0]).toMatchObject({eventKind: 'gm', previewText: 'Member: ping @channel'});
        expect(result.items[0].sourceRef).toMatchObject({broadcastMention: 'true', personalMention: ''});
    });

    test('uses a channel fallback preview when the post has no message', async () => {
        routeFetch({
            channels: [
                {id: 'dm-1', type: 'D', last_post_at: 500, display_name: 'Bob'},
                {id: 'gm-1', type: 'G', last_post_at: 400, display_name: 'Team'},
            ],
            posts: {
                'dm-1': [{id: 'post-1', user_id: 'bob', create_at: 500}],
                'gm-1': [{id: 'post-2', user_id: 'bob', create_at: 400}],
            },
        });

        const result = await new DMGMAdapter().fetch(makeParams());
        const previews = result.items.map((item) => item.previewText).sort();

        expect(previews).toEqual(['Direct message with Bob', 'Group message with Team']);
    });

    test('hides own posts and reminder completion system messages', async () => {
        routeFetch({
            channels: [{id: 'dm-1', type: 'D', last_post_at: 500}],
            posts: {
                'dm-1': [
                    {id: 'own', user_id: 'me', message: 'mine', create_at: 500},
                    {id: 'sys', user_id: 'bot', message: 'You marked the reminder as complete', create_at: 500},
                ],
            },
        });

        const result = await new DMGMAdapter().fetch(makeParams());

        expect(result.items).toEqual([]);
    });

    test('filters channels and posts outside the requested window', async () => {
        routeFetch({
            channels: [
                {id: 'stale', type: 'D', last_post_at: 50},
                {id: 'dm-1', type: 'D', last_post_at: 500},
            ],
            posts: {
                'dm-1': [
                    {id: 'old', user_id: 'bob', message: 'old', create_at: 50},
                    {id: 'kept', user_id: 'bob', message: 'kept', create_at: 150},
                    {id: 'future', user_id: 'bob', message: 'future', create_at: 500},
                ],
            },
        });

        const result = await new DMGMAdapter().fetch(makeParams({sinceMs: 100, beforeMs: 200}));

        expect(result.items.map((item) => item.postId)).toEqual(['kept']);
    });

    test('returns a next cursor when a channel page is full', async () => {
        routeFetch({
            channels: [{id: 'dm-1', type: 'D', last_post_at: 500}],
            posts: {
                'dm-1': Array.from({length: 5}, (unused, index) => ({
                    id: `post-${index}`,
                    user_id: 'bob',
                    message: `m${index}`,
                    create_at: 500,
                })),
            },
        });

        const result = await new DMGMAdapter().fetch(makeParams({page: 2}));

        expect(result.nextCursor).toBe('3');
        expect(result.items).toHaveLength(5);
    });
});
