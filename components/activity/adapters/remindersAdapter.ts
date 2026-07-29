// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ActivityItem} from '../types';

import {fetchJSON} from '../api';

import type {ActivitySourceAdapter, AdapterFetchParams, AdapterFetchResult} from './types';

const remindersUnsupportedServers = new Set<string>();

function isNotFound(status?: number) {
    return status === 404;
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
            if (isNotFound(response.status)) {
                remindersUnsupportedServers.add(params.serverId);
                return {kind: this.kind, items: [], nextCursor: undefined};
            }
            return {kind: this.kind, items: [], error: response.error, nextCursor: undefined};
        }

        const reminders = Array.isArray(response.data) ? response.data : [];
        const hasFullPage = reminders.length >= params.pageSize;
        const items = reminders.
            filter((reminder): reminder is Record<string, unknown> => Boolean(reminder && typeof reminder === 'object')).
            map((reminder) => normalizeReminder(params.serverId, params.userId, reminder)).
            filter((item) => item.eventTs >= params.sinceMs).
            filter((item) => !params.beforeMs || item.eventTs < params.beforeMs);

        return {
            kind: this.kind,
            items,
            nextCursor: hasFullPage ? String(params.page + 1) : undefined,
        };
    }
}

