// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    formatActivityTime,
    getActivityActorName,
    getActivityDayBadgeLabel,
    getActivityDisplayKind,
    getActivityKindMetaTitle,
    getActivityMessage,
    getActivityPanelItemId,
    getActivityTitle,
    isActivityHighlightedItem,
    isReminderLikeItem,
} from './activityDisplay';
import type {ActivityItem} from './types';

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
    return {
        canonicalId: '',
        eventKind: 'mention',
        serverId: 'server-1',
        targetUserId: 'user-1',
        eventTs: 100,
        previewText: 'preview',
        ...overrides,
    };
}

describe('getActivityPanelItemId', () => {
    test('prefers the canonical id', () => {
        expect(getActivityPanelItemId(makeItem({canonicalId: 'canon-1', postId: 'p1'}))).toBe('canon-1');
    });

    test('falls back through reminder, post, thread, channel and timestamp', () => {
        expect(getActivityPanelItemId(makeItem({eventKind: 'reminder', reminderId: 'r1'}))).toBe('reminder:r1');
        expect(getActivityPanelItemId(makeItem({postId: 'p1'}))).toBe('mention:post:p1');
        expect(getActivityPanelItemId(makeItem({threadId: 't1'}))).toBe('mention:thread:t1');
        expect(getActivityPanelItemId(makeItem({channelId: 'c1'}))).toBe('mention:channel:c1');
        expect(getActivityPanelItemId(makeItem({eventTs: 42}))).toBe('mention:ts:42');
    });
});

describe('formatActivityTime', () => {
    test('returns an empty string for an invalid timestamp', () => {
        expect(formatActivityTime(Number.NaN)).toBe('');
    });

    test('formats today as a time and other days with the date', () => {
        const today = new Date();
        today.setHours(10, 30, 0, 0);
        expect(formatActivityTime(today.getTime())).toBe(
            new Date(today).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        );

        const past = new Date(2020, 0, 2, 10, 30);
        expect(formatActivityTime(past.getTime())).toContain('2020');
    });
});

describe('getActivityDayBadgeLabel', () => {
    test('labels today and yesterday', () => {
        const now = Date.now();
        expect(getActivityDayBadgeLabel(now)).toBe('Today');
        expect(getActivityDayBadgeLabel(now - (24 * 60 * 60 * 1000))).toBe('Yesterday');
    });

    test('labels older days with an iso-like day key', () => {
        expect(getActivityDayBadgeLabel(new Date(2020, 0, 2, 12).getTime())).toBe('2020-01-02');
    });

    test('returns an empty string for an invalid timestamp', () => {
        expect(getActivityDayBadgeLabel(Number.NaN)).toBe('');
    });
});

describe('actor, title and message', () => {
    test('uses the actor name from the source ref', () => {
        expect(getActivityActorName(makeItem({sourceRef: {actorName: ' Alice '}}))).toBe('Alice');
    });

    test('derives the actor from a dm preview prefix only', () => {
        expect(getActivityActorName(makeItem({eventKind: 'dm', previewText: 'Bob: hello'}))).toBe('Bob');
        expect(getActivityActorName(makeItem({eventKind: 'mention', previewText: 'Bob: hello'}))).toBe('');
        expect(getActivityActorName(makeItem({eventKind: 'dm', previewText: 'hello'}))).toBe('');
    });

    test('strips the actor prefix from dm and gm messages', () => {
        expect(getActivityMessage(makeItem({eventKind: 'dm', previewText: 'Bob: hello'}), 'Bob')).toBe('hello');
        expect(getActivityMessage(makeItem({eventKind: 'gm', previewText: 'Bob: hello'}), '')).toBe('hello');
        expect(getActivityMessage(makeItem({eventKind: 'dm', previewText: 'hello'}), 'Bob')).toBe('hello');
    });

    test('keeps non-dm previews and falls back to the link url', () => {
        expect(getActivityMessage(makeItem({previewText: 'hi there'}), '')).toBe('hi there');
        expect(getActivityMessage(makeItem({previewText: '', sourceRef: {linkUrl: '/a/b'}}), '')).toBe('/a/b');
    });

    test('titles fall back to a humanized event kind', () => {
        expect(getActivityTitle(makeItem(), 'Alice')).toBe('Alice');
        expect(getActivityTitle(makeItem({eventKind: 'dm'}), '')).toBe('Direct message');
        expect(getActivityTitle(makeItem({eventKind: 'gm'}), '')).toBe('Group message');
        expect(getActivityTitle(makeItem({eventKind: 'thread_reply'}), '')).toBe('Thread Reply');
        expect(getActivityKindMetaTitle('thread_reply')).toBe('Thread Reply');
    });
});

describe('reminder detection', () => {
    test('detects reminders by kind, id, actor and preview text', () => {
        expect(isReminderLikeItem(makeItem({eventKind: 'reminder'}), '')).toBe(true);
        expect(isReminderLikeItem(makeItem({reminderId: 'r1'}), '')).toBe(true);
        expect(isReminderLikeItem(makeItem({sourceRef: {reminderId: 'r1'}}), '')).toBe(true);
        expect(isReminderLikeItem(makeItem(), 'RemindBot')).toBe(true);
        expect(isReminderLikeItem(makeItem({previewText: 'You asked me to remind you about it'}), '')).toBe(true);
        expect(isReminderLikeItem(makeItem({previewText: 'hello'}), 'Alice')).toBe(false);
    });

    test('display kind switches to reminder for reminder-like items', () => {
        expect(getActivityDisplayKind(makeItem({previewText: 'I will remind you about lunch'}))).toBe('reminder');
        expect(getActivityDisplayKind(makeItem({previewText: 'hello'}))).toBe('mention');
    });
});

describe('isActivityHighlightedItem', () => {
    test('highlights dm, gm, reminder and reaction items', () => {
        expect(isActivityHighlightedItem(makeItem({eventKind: 'dm'}))).toBe(true);
        expect(isActivityHighlightedItem(makeItem({eventKind: 'gm'}))).toBe(true);
        expect(isActivityHighlightedItem(makeItem({eventKind: 'reminder'}))).toBe(true);
        expect(isActivityHighlightedItem(makeItem({eventKind: 'reaction'}))).toBe(true);
    });

    test('highlights mentions only when personal or broadcast', () => {
        expect(isActivityHighlightedItem(makeItem({sourceRef: {personalMention: 'true'}}))).toBe(true);
        expect(isActivityHighlightedItem(makeItem({
            eventKind: 'thread_reply',
            sourceRef: {broadcastMention: 'true'},
        }))).toBe(true);
        expect(isActivityHighlightedItem(makeItem())).toBe(false);
    });
});
