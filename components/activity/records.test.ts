// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    formatChannelDisplayName,
    formatUserDisplayName,
    getObject,
    getPostsFromPayload,
    getString,
    toRecordArray,
} from './records';

describe('activity records helpers', () => {
    test('formatUserDisplayName prefers full name and falls back to username', () => {
        expect(formatUserDisplayName({first_name: 'Ada', last_name: 'Lovelace', username: 'ada'})).toBe('Ada Lovelace');
        expect(formatUserDisplayName({username: 'ada'})).toBe('ada');
        expect(formatUserDisplayName()).toBe('');
    });

    test('formatChannelDisplayName prefers display name', () => {
        expect(formatChannelDisplayName({id: 'c1', display_name: ' Town Square ', name: 'town-square'})).toBe('Town Square');
        expect(formatChannelDisplayName({id: 'c1', name: 'town-square'})).toBe('town-square');
        expect(formatChannelDisplayName()).toBe('');
    });

    test('getString and getObject narrow unknown values', () => {
        expect(getString('a')).toBe('a');
        expect(getString(3)).toBe('');
        expect(getObject({a: 1})).toEqual({a: 1});
        expect(getObject([1])).toBeUndefined();
        expect(getObject(null)).toBeUndefined();
    });

    test('toRecordArray keeps only object entries', () => {
        expect(toRecordArray([{a: 1}, null, 'x', {b: 2}])).toEqual([{a: 1}, {b: 2}]);
        expect(toRecordArray('nope')).toEqual([]);
    });

    test('getPostsFromPayload supports ordered maps and plain arrays', () => {
        const payload = {
            order: ['p2', 'p1'],
            posts: {p1: {id: 'p1'}, p2: {id: 'p2'}},
        };
        expect(getPostsFromPayload(payload)).toEqual([{id: 'p2'}, {id: 'p1'}]);
        expect(getPostsFromPayload([{id: 'p1'}])).toEqual([{id: 'p1'}]);
        expect(getPostsFromPayload({posts: {p1: {id: 'p1'}}})).toEqual([]);
        expect(getPostsFromPayload(null)).toEqual([]);
    });
});
