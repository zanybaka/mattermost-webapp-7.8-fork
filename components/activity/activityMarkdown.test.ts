// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {escapeHtml, renderActivityMarkdown, sanitizeActivityLinkUrl, stripMarkdownSyntax} from './activityMarkdown';

describe('sanitizeActivityLinkUrl', () => {
    test('keeps same-origin and http(s) links', () => {
        expect(sanitizeActivityLinkUrl('/team/pl/abc')).toBe('/team/pl/abc');
        expect(sanitizeActivityLinkUrl('https://example.com/a')).toBe('https://example.com/a');
        expect(sanitizeActivityLinkUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    });

    test('rejects script-like schemes', () => {
        /* eslint-disable no-script-url */
        expect(sanitizeActivityLinkUrl('javascript:alert(1)')).toBe('');
        expect(sanitizeActivityLinkUrl('JavaScript:alert(1)')).toBe('');

        /* eslint-enable no-script-url */
        expect(sanitizeActivityLinkUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });

    test('rejects protocol-relative URLs', () => {
        expect(sanitizeActivityLinkUrl('//evil.example.com/phish')).toBe('');
        expect(sanitizeActivityLinkUrl('/\\evil.example.com/phish')).toBe('');
        expect(sanitizeActivityLinkUrl('\\\\evil.example.com/phish')).toBe('');
    });
});

describe('escapeHtml', () => {
    test('escapes quote characters used in attributes', () => {
        expect(escapeHtml('<img src="x" onerror=\'y\'>')).toBe('&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;');
    });
});

describe('stripMarkdownSyntax', () => {
    test('removes markdown metacharacters from untrusted text', () => {
        expect(stripMarkdownSyntax('[Reset password](https://evil.example.com)')).toBe('Reset passwordhttps://evil.example.com');
        expect(stripMarkdownSyntax('Jane **Doe**')).toBe('Jane Doe');
    });
});

describe('renderActivityMarkdown', () => {
    test('escapes HTML in message text', () => {
        expect(renderActivityMarkdown('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('does not emit links for unsafe URLs', () => {
        expect(renderActivityMarkdown('[click](javascript:alert(1))')).not.toContain('<a ');
        expect(renderActivityMarkdown('[click](//evil.example.com)')).not.toContain('<a ');
    });

    test('emits safe links with noopener', () => {
        expect(renderActivityMarkdown('[click](https://example.com)')).
            toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">click</a>');
    });
});
