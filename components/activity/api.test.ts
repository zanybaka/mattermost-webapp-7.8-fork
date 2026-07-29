// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON, fetchJSONCached, getEmojiImageURL, getUserAvatarURL, postJSON} from './api';

function jsonResponse(body: string, {ok = true, status = 200} = {}) {
    return {
        ok,
        status,
        text: () => Promise.resolve(body),
    } as unknown as Response;
}

describe('activity api', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    test('fetchJSON normalizes the path and parses json', async () => {
        fetchMock.mockResolvedValue(jsonResponse('{"a":1}'));

        await expect(fetchJSON('api/v4/users/me')).resolves.toEqual({ok: true, data: {a: 1}});
        expect(fetchMock.mock.calls[0][0]).toBe('/api/v4/users/me');
        expect(fetchMock.mock.calls[0][1]).toMatchObject({method: 'GET', credentials: 'include'});
    });

    test('fetchJSON returns null data for an empty body', async () => {
        fetchMock.mockResolvedValue(jsonResponse(''));

        await expect(fetchJSON('/a')).resolves.toEqual({ok: true, data: null});
    });

    test('fetchJSON reports http errors with the status', async () => {
        fetchMock.mockResolvedValue(jsonResponse('nope', {ok: false, status: 404}));

        await expect(fetchJSON('/a')).resolves.toEqual({ok: false, error: 'request failed with status 404'});
    });

    test('fetchJSON reports invalid json', async () => {
        fetchMock.mockResolvedValue(jsonResponse('not-json'));

        const result = await fetchJSON('/a');
        expect(result.ok).toBe(false);
        expect(result.error).toEqual(expect.any(String));
    });

    test('fetchJSON reports body read failures', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.reject(new Error('read failed')),
        } as unknown as Response);

        await expect(fetchJSON('/a')).resolves.toEqual({ok: false, error: 'read failed'});
    });

    test('fetchJSON reports network failures', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));

        await expect(fetchJSON('/a')).resolves.toEqual({ok: false, error: 'offline'});
    });

    test('fetchJSON reports aborts as timeouts', async () => {
        fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));

        const result = await fetchJSON('/a');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('request timeout');
    });

    test('postJSON sends a json body', async () => {
        fetchMock.mockResolvedValue(jsonResponse('{"ok":true}'));

        await postJSON('/a', {b: 2});

        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: '{"b":2}',
        });
    });

    test('fetchJSONCached caches successful responses and dedupes in-flight requests', async () => {
        fetchMock.mockResolvedValue(jsonResponse('{"a":1}'));
        const path = `/cached-${Date.now()}`;

        const [first, second] = await Promise.all([fetchJSONCached(path), fetchJSONCached(path)]);
        expect(first).toEqual(second);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await fetchJSONCached(path);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('fetchJSONCached does not cache failures', async () => {
        fetchMock.mockResolvedValue(jsonResponse('boom', {ok: false, status: 500}));
        const path = `/failing-${Date.now()}`;

        await fetchJSONCached(path);
        await fetchJSONCached(path);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('fetchJSONCached refetches once the ttl expires', async () => {
        fetchMock.mockResolvedValue(jsonResponse('{"a":1}'));
        const path = `/ttl-${Date.now()}`;

        await fetchJSONCached(path, -1);
        await fetchJSONCached(path, -1);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('media urls', () => {
    test('encode their identifiers', () => {
        expect(getUserAvatarURL('user id/1')).toBe('/api/v4/users/user%20id%2F1/image');
        expect(getEmojiImageURL('emoji id')).toBe('/api/v4/emoji/emoji%20id/image');
    });
});
