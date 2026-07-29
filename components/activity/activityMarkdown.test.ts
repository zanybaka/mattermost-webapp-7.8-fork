// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {escapeHtml, renderActivityMarkdown, sanitizeActivityLinkUrl} from './activityMarkdown';

const UNSAFE_SCRIPT_URL = `java${'script'}:alert(1)`;

describe('escapeHtml', () => {
    test('escapes html sensitive characters', () => {
        expect(escapeHtml('<a href="x">a & b</a>')).toBe('&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;');
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
        expect(sanitizeActivityLinkUrl('data:text/html,<script>')).toBe('');
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
});
