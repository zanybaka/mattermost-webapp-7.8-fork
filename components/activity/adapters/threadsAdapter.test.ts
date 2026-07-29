// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON, fetchJSONCached} from '../api';
import {getCurrentUserUsername, replaceMentionUsernamesWithDisplayNames} from '../mentionDisplay';

import {ThreadsAdapter} from './threadsAdapter';
import type {AdapterFetchParams} from './types';

jest.mock('../api', () => ({
    fetchJSON: jest.fn(),
    fetchJSONCached: jest.fn(),
    getUserAvatarURL: (id: string) => `/api/v4/users/${id}/image`,
}));

jest.mock('../mentionDisplay', () => ({
    getCurrentUserUsername: jest.fn(),
    replaceMentionUsernamesWithDisplayNames: jest.fn(),
}));

const fetchJSONMock = fetchJSON as jest.MockedFunction<typeof fetchJSON>;
const fetchJSONCachedMock = fetchJSONCached as jest.MockedFunction<typeof fetchJSONCached>;
const getCurrentUserUsernameMock = getCurrentUserUsername as jest.MockedFunction<typeof getCurrentUserUsername>;
const replaceMentionsMock = replaceMentionUsernamesWithDisplayNames as jest.MockedFunction<
    typeof replaceMentionUsernamesWithDisplayNames
>;

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

function routeFetch(threadsByEndpoint: Record<string, unknown>, teams: unknown[] = []) {
    fetchJSONMock.mockImplementation(async (path: string) => {
        if (path === '/api/v4/users/me/teams') {
            return {ok: true, data: teams};
        }
        if (path in threadsByEndpoint) {
            return threadsByEndpoint[path] as {ok: boolean};
        }
        return {ok: false, error: 'request failed with status 404'};
    });
}

const BASE_THREADS_ENDPOINT = '/api/v4/users/me/teams/threads?page=0&per_page=30&extended=true';

describe('ThreadsAdapter', () => {
    beforeEach(() => {
        getCurrentUserUsernameMock.mockResolvedValue('me-username');
        replaceMentionsMock.mockImplementation(async (serverId, value) => ({
            text: value,
            hasPersonalMention: false,
            hasBroadcastMention: false,
        }));
        fetchJSONCachedMock.mockResolvedValue({ok: false, error: 'not found'});
    });

    test('returns the last error when no thread could be fetched', async () => {
        routeFetch({});

        const result = await new ThreadsAdapter().fetch(makeParams());

        expect(result).toEqual({kind: 'thread_reply', items: [], error: 'request failed with status 404'});
    });

    test('normalizes threads with actor, channel and mention metadata', async () => {
        routeFetch({
            [BASE_THREADS_ENDPOINT]: {
                ok: true,
                data: {
                    threads: [
                        {
                            id: 'root-1',
                            post_id: 'post-1',
                            channel_id: 'channel-1',
                            last_reply_at: 500,
                            last_reply_user_id: 'bob',
                            last_reply_text: 'hey @me-username',
                        },
                        null,
                    ],
                },
            },
        });
        fetchJSONCachedMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/users/me/channels') {
                return {ok: true, data: [{id: 'channel-1', display_name: 'Town Square'}, {}, null]};
            }
            return {ok: true, data: {id: 'bob', first_name: 'Bob', last_name: 'Ross'}};
        });
        replaceMentionsMock.mockResolvedValue({
            text: 'hey @Me',
            hasPersonalMention: true,
            hasBroadcastMention: false,
        });

        const result = await new ThreadsAdapter().fetch(makeParams());

        expect(result.nextCursor).toBe('1');
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            eventKind: 'thread_reply',
            postId: 'post-1',
            threadId: 'root-1',
            channelId: 'channel-1',
            eventTs: 500,
            previewText: 'hey @Me',
            actorUserId: 'bob',
            actorAvatarUrl: '/api/v4/users/bob/image',
        });
        expect(result.items[0].sourceRef).toMatchObject({
            actorName: 'Bob Ross',
            channelName: 'Town Square',
            personalMention: 'true',
            broadcastMention: '',
        });
    });

    test('falls back to the root post for the snippet, actor, channel and timestamp', async () => {
        routeFetch({
            [BASE_THREADS_ENDPOINT]: {
                ok: true,
                data: {
                    threads: [{
                        id: 'root-1',
                        post: {message: 'root message', user_id: 'bob', channel_id: 'channel-1', create_at: 700},
                    }],
                },
            },
        });

        const result = await new ThreadsAdapter().fetch(makeParams());

        expect(result.items[0]).toMatchObject({
            previewText: 'root message',
            actorUserId: 'bob',
            channelId: 'channel-1',
            postId: 'root-1',
            eventTs: 700,
        });
    });

    test('queries team scoped endpoints when the user has teams', async () => {
        routeFetch({}, [{id: 'team-1'}, null]);

        await new ThreadsAdapter().fetch(makeParams());

        const paths = fetchJSONMock.mock.calls.map((call) => call[0]);
        expect(paths).toContain(BASE_THREADS_ENDPOINT);
        expect(paths.some((path) => path.startsWith('/api/v4/users/me/teams/team-1/threads?'))).toBe(true);
        expect(paths.some((path) => path.startsWith('/api/v4/users/me/teams/team-1/threads?'))).toBe(true);
    });

    test('drops own replies and items outside the requested window', async () => {
        routeFetch({
            [BASE_THREADS_ENDPOINT]: {
                ok: true,
                data: {
                    threads: [
                        {id: 'mine', last_reply_user_id: 'me', last_reply_at: 150, message: 'mine'},
                        {id: 'old', last_reply_user_id: 'bob', last_reply_at: 50, message: 'old'},
                        {id: 'kept', last_reply_user_id: 'bob', last_reply_at: 150, message: 'kept'},
                        {id: 'future', last_reply_user_id: 'bob', last_reply_at: 500, message: 'future'},
                    ],
                },
            },
        });

        const result = await new ThreadsAdapter().fetch(makeParams({sinceMs: 100, beforeMs: 200}));

        expect(result.items.map((item) => item.threadId)).toEqual(['kept']);
    });
});
