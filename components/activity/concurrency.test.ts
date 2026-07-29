// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {forEachWithConcurrency} from './concurrency';

describe('forEachWithConcurrency', () => {
    test('processes every item exactly once', async () => {
        const items = [1, 2, 3, 4, 5];
        const seen: number[] = [];

        await forEachWithConcurrency(items, 2, async (item) => {
            seen.push(item);
        });

        expect(seen.sort()).toEqual(items);
    });

    test('never runs more than the requested number of callbacks at once', async () => {
        let running = 0;
        let maxRunning = 0;

        await forEachWithConcurrency([1, 2, 3, 4, 5, 6], 3, async () => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await Promise.resolve();
            running -= 1;
        });

        expect(maxRunning).toBe(3);
    });

    test('handles an empty list without invoking the callback', async () => {
        const callback = jest.fn();

        await forEachWithConcurrency([], 4, callback);

        expect(callback).not.toHaveBeenCalled();
    });

    test('rejects when a callback rejects', async () => {
        await expect(forEachWithConcurrency([1], 1, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
    });
});
