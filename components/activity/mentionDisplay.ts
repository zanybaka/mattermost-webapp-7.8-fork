// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchJSONCached} from './api';

type UserRecord = {
    username?: string;
    first_name?: string;
    last_name?: string;
};

const USERNAME_DISPLAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BROADCAST_MENTION_KEYS = new Set(['all', 'channel', 'here']);

function formatUserDisplayName(user?: UserRecord): string {
    if (!user) {
        return '';
    }
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return fullName || user.username || '';
}

function extractMentionUsernames(text: string): string[] {
    const regex = /(^|[\s(])@([a-z0-9._-]+)/gi;
    const usernames = new Set<string>();
    let match = regex.exec(text);
    while (match) {
        usernames.add((match[2] || '').toLowerCase());
        match = regex.exec(text);
    }
    return Array.from(usernames).filter((username) => Boolean(username) && !BROADCAST_MENTION_KEYS.has(username));
}

async function resolveDisplayNameByUsername(serverId: string, username: string): Promise<string | null> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
        return null;
    }

    // serverId is kept for multi-server parity/typing (webapp currently uses a single session).
    const response = await fetchJSONCached(
        `/api/v4/users/username/${encodeURIComponent(normalizedUsername)}`,
        USERNAME_DISPLAY_CACHE_TTL_MS,
    );

    if (!response.ok || !response.data || typeof response.data !== 'object') {
        return null;
    }

    const displayName = formatUserDisplayName(response.data as UserRecord).trim();
    return displayName || null;
}

export async function replaceMentionUsernamesWithDisplayNames(
    serverId: string,
    value: string,
    cache: Map<string, string | null>,
    selfUsername = '',
): Promise<{text: string; hasPersonalMention: boolean; hasBroadcastMention: boolean}> {
    const text = value || '';
    if (!text || text.startsWith('http://') || text.startsWith('https://') || !text.includes('@')) {
        return {text, hasPersonalMention: false, hasBroadcastMention: false};
    }

    const normalizedSelfUsername = selfUsername.trim().toLowerCase();
    const hasBroadcastMention = (/(^|[\s(])@(here|all|channel)\b/i).test(text);
    const usernames = extractMentionUsernames(text);

    await Promise.all(usernames.map(async (username) => {
        if (cache.has(username)) {
            return;
        }
        const displayName = await resolveDisplayNameByUsername(serverId, username);
        cache.set(username, displayName);
    }));

    let hasPersonalMention = false;
    const renderedText = text.replace(/(^|[\s(])@([a-z0-9._-]+)/gi, (fullMatch, prefix: string, username: string) => {
        if (normalizedSelfUsername && String(username || '').toLowerCase() === normalizedSelfUsername) {
            hasPersonalMention = true;
        }
        const replacement = cache.get((username || '').toLowerCase());
        if (!replacement) {
            return fullMatch;
        }
        return `${prefix}@${replacement}`;
    });

    return {
        text: renderedText,
        hasPersonalMention,
        hasBroadcastMention,
    };
}

export async function getCurrentUserUsername(serverId: string, userId: string): Promise<string> {
    if (!userId) {
        return '';
    }
    const response = await fetchJSONCached(`/api/v4/users/${encodeURIComponent(userId)}`);
    if (!response.ok || !response.data || typeof response.data !== 'object') {
        return '';
    }
    return String((response.data as UserRecord).username || '').trim();
}

