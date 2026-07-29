// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import {toRecordArray} from '../records';

import {fetchJSON} from '../api';

import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';

import {filterItemsByWindow} from './shared';

const remindersUnsupportedServers = new Set<string>();

function isNotFoundError(error?: string) {
    return Boolean(error && error.includes('status 404'));
}

function normalizeReminder(serverId: string, userId: string, reminder: Record<string, unknown>): ActivityItem {
    const reminderId = String(reminder.id || reminder.reminder_id || '');
    const postId = String(reminder.post_id || '');
    const remindAt = Number(reminder.remind_at || reminder.create_at || Date.now());
    const text = String(reminder.message || reminder.note || 'Reminder');

    return {
        canonicalId: '',
        eventKind: 'reminder',
        serverId,
        targetUserId: userId,
        eventTs: remindAt,
        previewText: text,
        reminderId: reminderId || undefined,
        postId: postId || undefined,
        sourceRef: {reminderId, postId},
    };
}

export class RemindersAdapter implements ActivitySourceAdapter {
    kind: AdapterFetchResult['kind'] = 'reminder';

    async fetch(params: AdapterFetchParams): Promise<AdapterFetchResult> {
        if (remindersUnsupportedServers.has(params.serverId)) {
            return {kind: this.kind, items: [], nextCursor: undefined};
        }

        // Best-effort endpoint for reminder retrieval; returns empty on unsupported deployments.
        const endpoint = `/api/v4/users/me/reminders?page=${params.page}&per_page=${params.pageSize}`;
        const response = await fetchJSON(endpoint);
        if (!response.ok) {
            if (isNotFoundError(response.error)) {
                remindersUnsupportedServers.add(params.serverId);
                return {kind: this.kind, items: [], nextCursor: undefined};
            }
            return {kind: this.kind, items: [], error: response.error, nextCursor: undefined};
        }

        const items = filterItemsByWindow(
            toRecordArray(response.data).map((reminder) => normalizeReminder(params.serverId, params.userId, reminder)),
            params,
        );

        return {
            kind: this.kind,
            items,
            nextCursor: String(params.page + 1),
        };
    }
}

