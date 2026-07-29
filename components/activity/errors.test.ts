// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {logActivityError, toErrorMessage} from './errors';

describe('activity errors', () => {
    test('extracts message from Error instances', () => {
        expect(toErrorMessage(new Error('boom'))).toBe('boom');
    });

    test('falls back for empty or non-error values', () => {
        expect(toErrorMessage(new Error(''), 'fallback')).toBe('fallback');
        expect(toErrorMessage({}, 'fallback')).toBe('fallback');
        expect(toErrorMessage('  ', 'fallback')).toBe('fallback');
        expect(toErrorMessage('plain failure')).toBe('plain failure');
    });

    test('logs scoped warnings', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        logActivityError('mentions adapter failed', new Error('network down'));
        expect(warn).toHaveBeenCalledWith('[activity] mentions adapter failed: network down');

        warn.mockRestore();
    });
});
