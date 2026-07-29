// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Ported from Mattermost Desktop Activity panel injection (externalAPI.ts).

import type {MessageDescriptor} from 'react-intl';

import {t} from 'utils/i18n';

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

export const ACTIVITY_KIND_LABELS: Record<ActivityEventKind, MessageDescriptor> = {
    mention: {id: t('activity.kind.mention'), defaultMessage: 'Mention'},
    thread_reply: {id: t('activity.kind.threadReply'), defaultMessage: 'Thread reply'},
    reaction: {id: t('activity.kind.reaction'), defaultMessage: 'Reaction'},
    dm: {id: t('activity.kind.dm'), defaultMessage: 'Direct message'},
    gm: {id: t('activity.kind.gm'), defaultMessage: 'Group message'},
    reminder: {id: t('activity.kind.reminder'), defaultMessage: 'Reminder'},
};

export const ACTIVITY_DAY_LABELS = {
    today: {id: t('activity.day.today'), defaultMessage: 'Today'},
    yesterday: {id: t('activity.day.yesterday'), defaultMessage: 'Yesterday'},
};

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

export function getActivityDayBadge(ts: number): {key: string; descriptor?: MessageDescriptor} {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
        return {key: ''};
    }

    const now = new Date();
    if (isSameLocalDay(date, now)) {
        return {key: 'today', descriptor: ACTIVITY_DAY_LABELS.today};
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameLocalDay(date, yesterday)) {
        return {key: 'yesterday', descriptor: ACTIVITY_DAY_LABELS.yesterday};
    }

    return {key: toLocalDayKey(date)};
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

