// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export function toErrorMessage(error: unknown, fallback = 'unexpected error'): string {
    if (error instanceof Error) {
        return error.message || fallback;
    }
    if (typeof error === 'string' && error.trim()) {
        return error;
    }
    return fallback;
}

// Reports failures that are recovered from but should stay visible to developers.
export function logActivityError(scope: string, error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(`[activity] ${scope}: ${toErrorMessage(error)}`);
}
