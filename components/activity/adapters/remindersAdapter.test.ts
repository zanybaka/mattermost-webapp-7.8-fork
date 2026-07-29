// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSON} from '../api';

import {RemindersAdapter} from './remindersAdapter';
import type {AdapterFetchParams} from './types';

jest.mock('../api', () => ({
    fetchJSON: jest.fn(),
}));

const fetchJSONMock = fetchJSON as jest.MockedFunction<typeof fetchJSON>;

function makeParams(overrides: Partial<AdapterFetchParams> = {}): AdapterFetchParams {
    return {
        serverId: `server-${Math.random()}`,
        userId: 'user-1',
        pageSize: 20,
        page: 0,
        sinceMs: 0,
        ...overrides,
    };
}

describe('RemindersAdapter', () => {
    test('normalizes reminders and returns the next cursor', async () => {
        fetchJSONMock.mockResolvedValue({
            ok: true,
            data: [
                {id: 'r1', post_id: 'p1', remind_at: 500, message: 'Standup'},
                null,
            ],
        });

        const result = await new RemindersAdapter().fetch(makeParams());

        expect(fetchJSONMock).toHaveBeenCalledWith('/api/v4/users/me/reminders?page=0&per_page=20');
        expect(result.kind).toBe('reminder');
        expect(result.nextCursor).toBe('1');
        expect(result.items).toEqual([{
            canonicalId: '',
            eventKind: 'reminder',
            serverId: expect.any(String),
            targetUserId: 'user-1',
            eventTs: 500,
            previewText: 'Standup',
            reminderId: 'r1',
            postId: 'p1',
            sourceRef: {reminderId: 'r1', postId: 'p1'},
        }]);
    });

    test('filters reminders outside the requested window', async () => {
        fetchJSONMock.mockResolvedValue({
            ok: true,
            data: [
                {id: 'old', remind_at: 50},
                {id: 'inside', remind_at: 150},
                {id: 'future', remind_at: 500},
            ],
        });

        const result = await new RemindersAdapter().fetch(makeParams({sinceMs: 100, beforeMs: 200}));

        expect(result.items.map((item) => item.reminderId)).toEqual(['inside']);
    });

    test('soft-falls back on 404 and stops calling the endpoint for that server', async () => {
        fetchJSONMock.mockResolvedValue({ok: false, error: 'request failed with status 404'});
        const adapter = new RemindersAdapter();
        const params = makeParams();

        const first = await adapter.fetch(params);
        expect(first).toEqual({kind: 'reminder', items: [], nextCursor: undefined});

        fetchJSONMock.mockClear();
        const second = await adapter.fetch(params);
        expect(second).toEqual({kind: 'reminder', items: [], nextCursor: undefined});
        expect(fetchJSONMock).not.toHaveBeenCalled();
    });

    test('surfaces other errors without disabling the source', async () => {
        fetchJSONMock.mockResolvedValue({ok: false, error: 'request failed with status 500'});
        const params = makeParams();

        const result = await new RemindersAdapter().fetch(params);
        expect(result).toEqual({kind: 'reminder', items: [], error: 'request failed with status 500', nextCursor: undefined});

        fetchJSONMock.mockResolvedValue({ok: true, data: []});
        await new RemindersAdapter().fetch(params);
        expect(fetchJSONMock).toHaveBeenCalledTimes(2);
    });

    test('handles a non-array payload', async () => {
        fetchJSONMock.mockResolvedValue({ok: true, data: null});

        const result = await new RemindersAdapter().fetch(makeParams());
        expect(result.items).toEqual([]);
    });
});
