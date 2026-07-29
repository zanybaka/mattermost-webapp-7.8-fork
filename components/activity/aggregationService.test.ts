// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {ActivityAggregationService} from './aggregationService';
import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './adapters/types';
import type {ActivityItem} from './types';

const NOW = 1_700_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function makeItem(postId: string, eventTs: number): ActivityItem {
    return {
        canonicalId: '',
        eventKind: 'mention',
        serverId: 'server-1',
        targetUserId: 'user-1',
        eventTs,
        previewText: `preview ${postId}`,
        postId,
    };
}

class StubAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'mention';
    calls: AdapterFetchParams[] = [];

    private readonly pages: ActivityItem[][];

    constructor(pages: ActivityItem[][]) {
        this.pages = pages;
    }

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        this.calls.push(params);
        const items = this.pages[params.page] || [];
        return {
            kind: this.kind,
            items,
            nextCursor: this.pages[params.page + 1] ? String(params.page + 1) : undefined,
        };
    }
}

describe('ActivityAggregationService', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('refresh keeps items already loaded with load older', async () => {
        // A full first page stops the initial load after a single round.
        const firstPage = Array.from({length: 30}, (unused, index) => makeItem(`post-${index}`, NOW - HOUR_MS - index));
        const adapter = new StubAdapter([firstPage, [makeItem('post-old', NOW - (2 * HOUR_MS))]]);
        const service = new ActivityAggregationService([adapter]);
        const context = {serverId: 'server-1', userId: 'user-1', nowMs: NOW};

        const initial = await service.loadInitial(context);
        expect(initial.items).toHaveLength(30);

        const olderPage = await service.loadOlder(context, service.getState('server-1')!);
        expect(olderPage.items).toHaveLength(31);

        const refreshed = await service.refresh(context, service.getState('server-1')!);
        expect(refreshed.items).toHaveLength(31);
        expect(refreshed.items.map((item) => item.postId)).toContain('post-old');
    });

    test('refresh does not rewind the paging position', async () => {
        const firstPage = Array.from({length: 30}, (unused, index) => makeItem(`post-${index}`, NOW - HOUR_MS - index));
        const adapter = new StubAdapter([
            firstPage,
            [makeItem('post-old-1', NOW - (2 * HOUR_MS))],
            [makeItem('post-old-2', NOW - (3 * HOUR_MS))],
        ]);
        const service = new ActivityAggregationService([adapter]);
        const context = {serverId: 'server-1', userId: 'user-1', nowMs: NOW};

        await service.loadInitial(context);
        await service.loadOlder(context, service.getState('server-1')!);
        const beforeRefresh = service.getState('server-1')!.sourceCursors.mention;

        await service.refresh(context, service.getState('server-1')!);
        expect(service.getState('server-1')!.sourceCursors.mention).toBe(beforeRefresh);
    });

    test('reports no more pages once every adapter is exhausted', async () => {
        const adapter = new StubAdapter([[makeItem('post-1', NOW - HOUR_MS)]]);
        const service = new ActivityAggregationService([adapter]);

        const page = await service.loadInitial({serverId: 'server-1', userId: 'user-1', nowMs: NOW});
        expect(page.hasMore).toBe(false);
    });
});
