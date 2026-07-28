// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const RESPONSE_CACHE_TTL_MS = 1000 * 60 * 10;
const REQUEST_TIMEOUT_MS = 15000;

export type ActivityFetchResult = {
    ok: boolean;
    data?: unknown;
    error?: string;
};

const responseCache = new Map<string, {expiresAt: number; value: ActivityFetchResult}>();
const inFlightRequests = new Map<string, Promise<ActivityFetchResult>>();

function normalizePath(path: string) {
    const normalized = (path || '').trim();
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function readJSONResponse(response: Response): Promise<ActivityFetchResult> {
    let raw = '';
    try {
        raw = await response.text();
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'failed to read response',
        };
    }

    if (!response.ok) {
        return {
            ok: false,
            error: `request failed with status ${response.status}`,
        };
    }

    if (!raw) {
        return {ok: true, data: null};
    }

    try {
        return {ok: true, data: JSON.parse(raw)};
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'failed to parse response',
        };
    }
}

async function fetchWithTimeout(path: string, init: RequestInit): Promise<ActivityFetchResult> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(path, {
            ...init,
            credentials: 'include',
            signal: controller.signal,
        });
        return await readJSONResponse(response);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return {
                ok: false,
                error: `request timeout after ${REQUEST_TIMEOUT_MS}ms`,
            };
        }
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'request failed',
        };
    } finally {
        window.clearTimeout(timeout);
    }
}

export async function fetchJSON(path: string): Promise<ActivityFetchResult> {
    return fetchWithTimeout(normalizePath(path), {method: 'GET'});
}

export async function postJSON(path: string, body: unknown): Promise<ActivityFetchResult> {
    return fetchWithTimeout(normalizePath(path), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

export async function fetchJSONCached(path: string, ttlMs = RESPONSE_CACHE_TTL_MS): Promise<ActivityFetchResult> {
    const normalizedPath = normalizePath(path);
    const now = Date.now();

    const cached = responseCache.get(normalizedPath);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const inFlight = inFlightRequests.get(normalizedPath);
    if (inFlight) {
        return inFlight;
    }

    const request = fetchJSON(normalizedPath).then((result) => {
        if (result.ok) {
            responseCache.set(normalizedPath, {
                expiresAt: Date.now() + ttlMs,
                value: result,
            });
        }
        return result;
    }).finally(() => {
        inFlightRequests.delete(normalizedPath);
    });

    inFlightRequests.set(normalizedPath, request);
    return request;
}

export function getUserAvatarURL(userId: string): string {
    return `/api/v4/users/${encodeURIComponent(userId)}/image`;
}

export function getEmojiImageURL(emojiId: string): string {
    return `/api/v4/emoji/${encodeURIComponent(emojiId)}/image`;
}

