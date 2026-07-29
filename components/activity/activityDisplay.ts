// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Ported from Mattermost Desktop Activity panel injection (externalAPI.ts).

import type {ActivityEventKind, ActivityItem} from './types';

export const ACTIVITY_KIND_ICONS: Record<ActivityEventKind, string> = {
    mention: 'icon-at',
    thread_reply: 'icon-reply-outline',
    reaction: 'icon-emoticon-plus-outline',
    dm: 'icon-account-outline',
    gm: 'icon-account-multiple-outline',
    reminder: 'icon-clock-outline',
};

export const ACTIVITY_FILTER_KINDS = ['mention', 'thread_reply', 'reaction', 'dm', 'gm', 'reminder'] as const;

export function getActivityPanelItemId(item: ActivityItem): string {
    if (item.canonicalId) {
        return item.canonicalId;
    }

    if (item.reminderId) {
        return `reminder:${item.reminderId}`;
    }

    if (item.postId) {
        return `${item.eventKind || 'event'}:post:${item.postId}`;
    }

    if (item.threadId) {
        return `${item.eventKind || 'event'}:thread:${item.threadId}`;
    }

    if (item.channelId) {
        return `${item.eventKind || 'event'}:channel:${item.channelId}`;
    }

    return `${item.eventKind || 'event'}:ts:${String(item.eventTs || 0)}`;
}

function getActivityKindLabel(eventKind: string) {
    return eventKind.
        split('_').
        map((part) => part.charAt(0).toUpperCase() + part.slice(1)).
        join(' ');
}

export function formatActivityTime(ts: number) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const now = new Date();
    const isToday = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

    if (isToday) {
        return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }

    return date.toLocaleString([], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function isSameLocalDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function toLocalDayKey(date: Date) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getActivityDayBadgeLabel(ts: number) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const now = new Date();
    if (isSameLocalDay(date, now)) {
        return 'Today';
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameLocalDay(date, yesterday)) {
        return 'Yesterday';
    }

    return toLocalDayKey(date);
}

export function getActivityActorName(item: ActivityItem) {
    const actorFromSource = (item.sourceRef?.actorName || '').trim();
    if (actorFromSource) {
        return actorFromSource;
    }

    if (item.eventKind !== 'dm' && item.eventKind !== 'gm') {
        return '';
    }

    const preview = (item.previewText || '').trim();
    const separatorIndex = preview.indexOf(':');
    if (separatorIndex > 0) {
        return preview.slice(0, separatorIndex).trim();
    }
    return '';
}

export function getActivityMessage(item: ActivityItem, actorName: string) {
    const preview = (item.previewText || '').trim();
    if (!preview) {
        return (item.sourceRef?.linkUrl || '').trim();
    }

    const isDmOrGm = item.eventKind === 'dm' || item.eventKind === 'gm';
    if (!isDmOrGm) {
        return preview;
    }

    if (actorName && preview.startsWith(`${actorName}:`)) {
        return preview.slice(actorName.length + 1).trim();
    }

    const separatorIndex = preview.indexOf(':');
    if (separatorIndex > 0) {
        return preview.slice(separatorIndex + 1).trim();
    }

    return preview;
}

export function getActivityTitle(item: ActivityItem, actorName: string) {
    if (actorName) {
        return actorName;
    }
    if (item.eventKind === 'dm') {
        return 'Direct message';
    }
    if (item.eventKind === 'gm') {
        return 'Group message';
    }
    return getActivityKindLabel(item.eventKind);
}

export function isReminderLikeItem(item: ActivityItem, actorName: string) {
    if (item.eventKind === 'reminder' || Boolean(item.reminderId) || Boolean(item.sourceRef?.reminderId)) {
        return true;
    }

    const actor = actorName.trim().toLowerCase();
    if (actor === 'remindbot') {
        return true;
    }

    const preview = (item.previewText || '').toLowerCase();
    return preview.includes('remind you about') || preview.includes('you asked me to remind you');
}

export function getActivityDisplayKind(item: ActivityItem) {
    const actorName = getActivityActorName(item);
    return isReminderLikeItem(item, actorName) ? 'reminder' : item.eventKind;
}

export function isActivityHighlightedItem(item: ActivityItem) {
    const kindForDisplay = getActivityDisplayKind(item);
    if (kindForDisplay === 'dm' || kindForDisplay === 'gm' || kindForDisplay === 'reminder') {
        return true;
    }
    if (item.eventKind === 'reaction') {
        return true;
    }
    if (item.eventKind === 'mention' || item.eventKind === 'thread_reply') {
        const hasPersonalMention = item.sourceRef?.personalMention === 'true';
        const hasBroadcastMention = item.sourceRef?.broadcastMention === 'true';
        return hasPersonalMention || hasBroadcastMention;
    }
    return false;
}

export function getActivityKindMetaTitle(eventKind: string) {
    return getActivityKindLabel(eventKind);
}

