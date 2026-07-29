// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {escapeHtml, renderActivityMarkdown, sanitizeActivityLinkUrl, stripMarkdownSyntax} from './activityMarkdown';

const UNSAFE_SCRIPT_URL = `java${'script'}:alert(1)`;

describe('escapeHtml', () => {
    test('escapes html sensitive characters', () => {
        expect(escapeHtml('<a href="x">a & b</a>')).toBe('&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;');
    });

    test('escapes single quotes', () => {
        expect(escapeHtml('<img src="x" onerror=\'y\'>')).toBe('&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;');
    });
});

describe('stripMarkdownSyntax', () => {
    test('removes markdown metacharacters from untrusted text', () => {
        expect(stripMarkdownSyntax('[Reset password](https://evil.example.com)')).toBe('Reset passwordhttps://evil.example.com');
        expect(stripMarkdownSyntax('Jane **Doe**')).toBe('Jane Doe');
    });
});

describe('sanitizeActivityLinkUrl', () => {
    test('keeps relative and anchor links as-is', () => {
        expect(sanitizeActivityLinkUrl('  /team/channels/town-square ')).toBe('/team/channels/town-square');
        expect(sanitizeActivityLinkUrl('#section')).toBe('#section');
    });

    test('keeps http, https and mailto links', () => {
        expect(sanitizeActivityLinkUrl('https://example.com/a')).toBe('https://example.com/a');
        expect(sanitizeActivityLinkUrl('http://example.com')).toBe('http://example.com');
        expect(sanitizeActivityLinkUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    });

    test('drops empty and unsafe protocols', () => {
        expect(sanitizeActivityLinkUrl('   ')).toBe('');
        expect(sanitizeActivityLinkUrl(UNSAFE_SCRIPT_URL)).toBe('');
        expect(sanitizeActivityLinkUrl(UNSAFE_SCRIPT_URL.toUpperCase())).toBe('');
        expect(sanitizeActivityLinkUrl('data:text/html,<script>')).toBe('');
    });

    test('drops protocol-relative urls', () => {
        expect(sanitizeActivityLinkUrl('//evil.example.com/phish')).toBe('');
        expect(sanitizeActivityLinkUrl('/\\evil.example.com/phish')).toBe('');
        expect(sanitizeActivityLinkUrl('\\\\evil.example.com/phish')).toBe('');
    });
});

describe('renderActivityMarkdown', () => {
    test('escapes plain text', () => {
        expect(renderActivityMarkdown('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;');
    });

    test('renders inline emphasis, code and strikethrough', () => {
        expect(renderActivityMarkdown('**bold** and *em* and `code` and ~~gone~~')).
            toBe('<strong>bold</strong> and <em>em</em> and <code>code</code> and <del>gone</del>');
    });

    test('renders headings as strong blocks', () => {
        expect(renderActivityMarkdown('## Title')).toBe('<strong>Title</strong>');
    });

    test('renders bullet and ordered lists', () => {
        expect(renderActivityMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
        expect(renderActivityMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    });

    test('starts a new list when the list type changes', () => {
        expect(renderActivityMarkdown('- one\n1. two')).toBe('<ul><li>one</li></ul><ol><li>two</li></ol>');
    });

    test('joins paragraph lines with line breaks and splits on blank lines', () => {
        expect(renderActivityMarkdown('a\nb\n\nc')).toBe('a<br/>bc');
    });

    test('auto links bare urls and keeps trailing punctuation outside the link', () => {
        expect(renderActivityMarkdown('see https://example.com/a.')).
            toBe('see <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>.');
    });

    test('renders markdown links and escapes unsafe ones', () => {
        expect(renderActivityMarkdown('[text](https://example.com)')).
            toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">text</a>');
        expect(renderActivityMarkdown(`[text](${UNSAFE_SCRIPT_URL}`)).toBe(`[text](${UNSAFE_SCRIPT_URL}`);
    });

    test('does not link unsafe or protocol-relative urls', () => {
        expect(renderActivityMarkdown(`[click](${UNSAFE_SCRIPT_URL})`)).not.toContain('<a ');
        expect(renderActivityMarkdown('[click](//evil.example.com)')).not.toContain('<a ');
    });
});
