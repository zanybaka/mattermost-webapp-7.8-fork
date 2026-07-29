// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import type {AdapterFetchParams} from './types';
import {buildPostSearchBody, clampSearchPerPage, filterItemsByWindow, mergePostSearchResults} from './shared';

function makeItem(eventTs: number): ActivityItem {
    return {
        canonicalId: `item-${eventTs}`,
        eventKind: 'mention',
        serverId: 'server',
        targetUserId: 'user',
        eventTs,
        previewText: '',
    };
}

describe('activity adapter shared helpers', () => {
    test('clampSearchPerPage stays within the server search bounds', () => {
        expect(clampSearchPerPage(1)).toBe(10);
        expect(clampSearchPerPage(40)).toBe(40);
        expect(clampSearchPerPage(1000)).toBe(100);
    });

    test('buildPostSearchBody only sets search_mentions when requested', () => {
        const body = buildPostSearchBody({terms: '"@ada"', page: 2, perPage: 50});
        expect(body).toMatchObject({terms: '"@ada"', page: 2, per_page: 50, is_or_search: true});
        expect(body.search_mentions).toBeUndefined();
        expect(buildPostSearchBody({terms: '', page: 0, perPage: 10, searchMentions: true}).search_mentions).toBe(true);
    });

    test('mergePostSearchResults dedupes by post id and reports errors only when empty', () => {
        const merged = mergePostSearchResults(
            {posts: [{id: 'p1'}, {id: 'p2'}]},
            {posts: [{id: 'p2'}], error: 'boom'},
        );
        expect(merged.posts.map((post) => post.id)).toEqual(['p1', 'p2']);
        expect(merged.error).toBeUndefined();

        expect(mergePostSearchResults({posts: [], error: 'boom'}).error).toBe('boom');
    });

    test('filterItemsByWindow applies the since/before window', () => {
        const params = {sinceMs: 100, beforeMs: 300} as AdapterFetchParams;
        const items = [makeItem(50), makeItem(100), makeItem(299), makeItem(300)];
        expect(filterItemsByWindow(items, params).map((item) => item.eventTs)).toEqual([100, 299]);

        const openEnded = {sinceMs: 100} as AdapterFetchParams;
        expect(filterItemsByWindow(items, openEnded).map((item) => item.eventTs)).toEqual([100, 299, 300]);
    });
});
