// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON, fetchJSONCached, postJSON} from '../api';
import {getCurrentUserUsername, replaceMentionUsernamesWithDisplayNames} from '../mentionDisplay';

import {MentionsAdapter} from './mentionsAdapter';
import type {AdapterFetchParams} from './types';

jest.mock('../api', () => ({
    fetchJSON: jest.fn(),
    fetchJSONCached: jest.fn(),
    postJSON: jest.fn(),
    getUserAvatarURL: (id: string) => `/api/v4/users/${id}/image`,
}));

jest.mock('../mentionDisplay', () => ({
    getCurrentUserUsername: jest.fn(),
    replaceMentionUsernamesWithDisplayNames: jest.fn(),
}));

const fetchJSONMock = fetchJSON as jest.MockedFunction<typeof fetchJSON>;
const fetchJSONCachedMock = fetchJSONCached as jest.MockedFunction<typeof fetchJSONCached>;
const postJSONMock = postJSON as jest.MockedFunction<typeof postJSON>;
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

function searchPayload(posts: Array<Record<string, unknown>>) {
    return {
        ok: true,
        data: {
            order: posts.map((post) => post.id),
            posts: Object.fromEntries(posts.map((post) => [post.id, post])),
        },
    };
}

const SEARCH_FAILURE = {ok: false, error: 'request failed with status 500'};

describe('MentionsAdapter', () => {
    beforeEach(() => {
        getCurrentUserUsernameMock.mockResolvedValue('me-username');
        replaceMentionsMock.mockImplementation(async (serverId, value) => ({
            text: value,
            hasPersonalMention: false,
            hasBroadcastMention: false,
        }));
        fetchJSONMock.mockResolvedValue({ok: true, data: []});
        fetchJSONCachedMock.mockResolvedValue({ok: false, error: 'not found'});
        postJSONMock.mockResolvedValue({ok: true, data: {order: [], posts: {}}});
    });

    test('returns nothing without a user id', async () => {
        const result = await new MentionsAdapter().fetch(makeParams({userId: ''}));

        expect(result).toEqual({kind: 'mention', items: [], nextCursor: undefined, error: undefined});
        expect(postJSONMock).not.toHaveBeenCalled();
    });

    test('uses search_mentions for the primary query and explicit broadcast queries', async () => {
        await new MentionsAdapter().fetch(makeParams());

        const bodies = postJSONMock.mock.calls.map((call) => call[1] as Record<string, unknown>);
        expect(bodies[0]).toMatchObject({search_mentions: true, terms: '', page: 0, per_page: 30});
        expect(bodies.map((body) => body.terms)).toEqual(expect.arrayContaining(['"@channel"', '"@all"', '"@here"']));
    });

    test('normalizes mention posts with actor and channel names', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            if ((body as {search_mentions?: boolean}).search_mentions) {
                return searchPayload([{
                    id: 'post-1',
                    user_id: 'bob',
                    channel_id: 'channel-1',
                    root_id: 'root-1',
                    create_at: 500,
                    message: 'hey @me-username',
                }]);
            }
            return {ok: true, data: {order: [], posts: {}}};
        });
        fetchJSONCachedMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/users/me/channels') {
                return {ok: true, data: [{id: 'channel-1', display_name: 'Town Square', type: 'O'}, {}, null]};
            }
            return {ok: true, data: {id: 'bob', first_name: 'Bob', last_name: 'Ross'}};
        });
        replaceMentionsMock.mockResolvedValue({text: 'hey @Me', hasPersonalMention: true, hasBroadcastMention: false});

        const result = await new MentionsAdapter().fetch(makeParams());

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            eventKind: 'mention',
            postId: 'post-1',
            channelId: 'channel-1',
            threadId: 'root-1',
            eventTs: 500,
            previewText: 'hey @Me',
            actorUserId: 'bob',
            actorAvatarUrl: '/api/v4/users/bob/image',
            isUnread: true,
        });
        expect(result.items[0].sourceRef).toMatchObject({
            actorName: 'Bob Ross',
            channelName: 'Town Square',
            personalMention: 'true',
            linkUrl: '',
        });
        expect(result.nextCursor).toBeUndefined();
    });

    test('merges broadcast search results with the primary results', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            const typed = body as {search_mentions?: boolean; terms: string};
            if (typed.search_mentions) {
                return searchPayload([{id: 'personal', user_id: 'bob', create_at: 500, message: 'hi'}]);
            }
            if (typed.terms === '"@channel"') {
                return searchPayload([{id: 'broadcast', user_id: 'bob', create_at: 400, message: 'all hands'}]);
            }
            return {ok: true, data: {order: [], posts: {}}};
        });

        const result = await new MentionsAdapter().fetch(makeParams());

        expect(result.items.map((item) => item.postId).sort()).toEqual(['broadcast', 'personal']);
    });

    test('falls back to mention-keyword search when nothing is found', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            const typed = body as {search_mentions?: boolean; terms: string};
            if (typed.terms.includes('"@me-username"')) {
                return searchPayload([{id: 'post-1', user_id: 'bob', create_at: 500, message: 'hi'}]);
            }
            return SEARCH_FAILURE;
        });
        fetchJSONCachedMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/users/me') {
                return {
                    ok: true,
                    data: {
                        id: 'me',
                        username: 'me-username',
                        first_name: 'Me',
                        notify_props: {first_name: 'true', channel: 'true', mention_keys: 'alias,@channel'},
                    },
                };
            }
            return {ok: false, error: 'not found'};
        });

        const result = await new MentionsAdapter().fetch(makeParams());

        const fallbackTerms = postJSONMock.mock.calls.
            map((call) => (call[1] as {terms: string}).terms).
            find((terms) => terms.includes('"@me-username"'));
        expect(fallbackTerms).toBe('"@me-username" "Me" "@alias"');
        expect(result.items.map((item) => item.postId)).toEqual(['post-1']);
    });

    test('fans out across teams only for supplemental queries', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            const typed = body as {search_mentions?: boolean};
            if (path === '/api/v4/posts/search') {
                return SEARCH_FAILURE;
            }
            if (typed.search_mentions) {
                return SEARCH_FAILURE;
            }
            return searchPayload([{id: 'post-1', user_id: 'bob', create_at: 500, message: 'hi'}]);
        });
        fetchJSONMock.mockResolvedValue({ok: true, data: [{id: 'team-1'}]});
        fetchJSONCachedMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/users/me') {
                return {ok: true, data: {id: 'me', username: 'me-username'}};
            }
            return {ok: false, error: 'not found'};
        });

        const result = await new MentionsAdapter().fetch(makeParams());

        expect(postJSONMock).not.toHaveBeenCalledWith('/api/v4/teams/team-1/posts/search', expect.any(Object));
        expect(result.items).toEqual([]);
        expect(result.error).toBe('request failed with status 500');
    });

    test('derives a preview from props and embeds when the message is empty', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            if ((body as {search_mentions?: boolean}).search_mentions) {
                return searchPayload([
                    {id: 'p1', user_id: 'bob', create_at: 500, props: {permalink: 'https://example.com/p'}},
                    {
                        id: 'p2',
                        user_id: 'bob',
                        create_at: 500,
                        props: {attachments: [null, {title_link: 'https://example.com/a'}]},
                    },
                    {id: 'p3', user_id: 'bob', create_at: 500, metadata: {embeds: [null, {url: 'https://example.com/e'}]}},
                    {id: 'p4', user_id: 'bob', create_at: 500},
                ]);
            }
            return {ok: true, data: {order: [], posts: {}}};
        });

        const result = await new MentionsAdapter().fetch(makeParams());

        expect(result.items.map((item) => item.previewText)).toEqual([
            'https://example.com/p',
            'https://example.com/a',
            'https://example.com/e',
            '',
        ]);
        expect(result.items[0].sourceRef?.linkUrl).toBe('https://example.com/p');
    });

    test('drops direct message posts, own posts and items outside the window', async () => {
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            if ((body as {search_mentions?: boolean}).search_mentions) {
                return searchPayload([
                    {id: 'dm', user_id: 'bob', channel_id: 'dm-1', create_at: 150, message: 'dm'},
                    {id: 'mine', user_id: 'me', create_at: 150, message: 'mine'},
                    {id: 'old', user_id: 'bob', create_at: 50, message: 'old'},
                    {id: 'kept', user_id: 'bob', create_at: 150, message: 'kept'},
                    {id: 'future', user_id: 'bob', create_at: 500, message: 'future'},
                ]);
            }
            return {ok: true, data: {order: [], posts: {}}};
        });
        fetchJSONCachedMock.mockImplementation(async (path: string) => {
            if (path === '/api/v4/users/me/channels') {
                return {ok: true, data: [{id: 'dm-1', type: 'D'}]};
            }
            return {ok: false, error: 'not found'};
        });

        const result = await new MentionsAdapter().fetch(makeParams({sinceMs: 100, beforeMs: 200}));

        expect(result.items.map((item) => item.postId)).toEqual(['kept']);
    });

    test('returns a next cursor when the page is full', async () => {
        const posts = Array.from({length: 10}, (unused, index) => ({
            id: `post-${index}`,
            user_id: 'bob',
            create_at: 500,
            message: `m${index}`,
        }));
        postJSONMock.mockImplementation(async (path: string, body: unknown) => {
            if ((body as {search_mentions?: boolean}).search_mentions) {
                return searchPayload(posts);
            }
            return {ok: true, data: {order: [], posts: {}}};
        });

        const result = await new MentionsAdapter().fetch(makeParams({pageSize: 10, page: 1}));

        expect(result.items).toHaveLength(10);
        expect(result.nextCursor).toBe('2');
    });
});
