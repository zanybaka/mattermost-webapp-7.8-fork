// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSONCached} from './api';
import {getCurrentUserUsername, replaceMentionUsernamesWithDisplayNames} from './mentionDisplay';

jest.mock('./api', () => ({
    fetchJSONCached: jest.fn(),
}));

const fetchJSONCachedMock = fetchJSONCached as jest.MockedFunction<typeof fetchJSONCached>;

describe('replaceMentionUsernamesWithDisplayNames', () => {
    test('returns the text untouched when there is nothing to resolve', async () => {
        const cache = new Map<string, string | null>();

        await expect(replaceMentionUsernamesWithDisplayNames('s1', '', cache)).resolves.toEqual({
            text: '',
            hasPersonalMention: false,
            hasBroadcastMention: false,
        });
        await expect(replaceMentionUsernamesWithDisplayNames('s1', 'no mentions here', cache)).resolves.toEqual({
            text: 'no mentions here',
            hasPersonalMention: false,
            hasBroadcastMention: false,
        });
        await expect(replaceMentionUsernamesWithDisplayNames('s1', 'https://example.com/@bob', cache)).resolves.toEqual({
            text: 'https://example.com/@bob',
            hasPersonalMention: false,
            hasBroadcastMention: false,
        });
        expect(fetchJSONCachedMock).not.toHaveBeenCalled();
    });

    test('replaces usernames with full names and flags a personal mention', async () => {
        fetchJSONCachedMock.mockResolvedValue({ok: true, data: {username: 'bob', first_name: 'Bob', last_name: 'Ross'}});
        const cache = new Map<string, string | null>();

        const result = await replaceMentionUsernamesWithDisplayNames('s1', 'hey @bob', cache, 'BOB');

        expect(result.text).toBe('hey @Bob Ross');
        expect(result.hasPersonalMention).toBe(true);
        expect(result.hasBroadcastMention).toBe(false);
        expect(cache.get('bob')).toBe('Bob Ross');
    });

    test('falls back to the username when there is no full name', async () => {
        fetchJSONCachedMock.mockResolvedValue({ok: true, data: {username: 'bob'}});

        const result = await replaceMentionUsernamesWithDisplayNames('s1', '@bob hi', new Map());
        expect(result.text).toBe('@bob hi');
    });

    test('keeps the raw mention when lookup fails and caches the miss', async () => {
        fetchJSONCachedMock.mockResolvedValue({ok: false, error: 'request failed with status 404'});
        const cache = new Map<string, string | null>();

        const result = await replaceMentionUsernamesWithDisplayNames('s1', 'hey @ghost', cache);

        expect(result.text).toBe('hey @ghost');
        expect(cache.get('ghost')).toBeNull();
    });

    test('reuses the cache instead of refetching', async () => {
        const cache = new Map<string, string | null>([['bob', 'Bob Ross']]);

        const result = await replaceMentionUsernamesWithDisplayNames('s1', '@bob', cache);

        expect(result.text).toBe('@Bob Ross');
        expect(fetchJSONCachedMock).not.toHaveBeenCalled();
    });

    test('flags broadcast mentions without resolving them', async () => {
        const result = await replaceMentionUsernamesWithDisplayNames('s1', 'ping @channel', new Map());

        expect(result.hasBroadcastMention).toBe(true);
        expect(result.text).toBe('ping @channel');
        expect(fetchJSONCachedMock).not.toHaveBeenCalled();
    });
});

describe('getCurrentUserUsername', () => {
    test('returns an empty string without a user id', async () => {
        await expect(getCurrentUserUsername('s1', '')).resolves.toBe('');
        expect(fetchJSONCachedMock).not.toHaveBeenCalled();
    });

    test('returns the username from the api', async () => {
        fetchJSONCachedMock.mockResolvedValue({ok: true, data: {username: ' bob '}});

        await expect(getCurrentUserUsername('s1', 'user id')).resolves.toBe('bob');
        expect(fetchJSONCachedMock).toHaveBeenCalledWith('/api/v4/users/user%20id');
    });

    test('returns an empty string when the request fails', async () => {
        fetchJSONCachedMock.mockResolvedValue({ok: false, error: 'boom'});

        await expect(getCurrentUserUsername('s1', 'u1')).resolves.toBe('');
    });
});
