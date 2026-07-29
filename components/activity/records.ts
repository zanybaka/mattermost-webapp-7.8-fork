// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type UserRecord = {
    id?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    notify_props?: Record<string, string>;
};

export type ChannelRecord = {
    id: string;
    type?: string;
    display_name?: string;
    name?: string;
    update_at?: number;
    last_post_at?: number;
};

export type PostRecord = {
    id: string;
    user_id?: string;
    message?: string;
    create_at?: number;
    update_at?: number;
};

export function getString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function getObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
}

export function formatUserDisplayName(user?: UserRecord): string {
    if (!user) {
        return '';
    }
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return fullName || user.username || '';
}

export function formatChannelDisplayName(channel?: ChannelRecord): string {
    if (!channel) {
        return '';
    }
    return (channel.display_name || channel.name || '').trim();
}

export function getPostsFromPayload(payload: unknown): Array<Record<string, unknown>> {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    if (Array.isArray(payload)) {
        return toRecordArray(payload);
    }

    const typed = payload as Record<string, unknown>;
    const order = Array.isArray(typed.order) ? typed.order.map(String) : [];
    if (!order.length) {
        return [];
    }

    const posts = (typed.posts || {}) as Record<string, unknown>;
    return order.
        map((id) => posts[id]).
        filter((post): post is Record<string, unknown> => Boolean(post && typeof post === 'object'));
}
