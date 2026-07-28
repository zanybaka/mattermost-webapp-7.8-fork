// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Ported from Mattermost Desktop Activity panel injection (externalAPI.ts).

export function escapeHtml(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sanitizeActivityLinkUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) {
        return '';
    }

    if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed, 'https://mattermost.local');
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
            return trimmed;
        }
    } catch {
        return '';
    }

    return '';
}

function renderActivityInlineMarkdown(value: string) {
    let html = escapeHtml(value);

    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
    html = html.replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');

    return html;
}

function splitTrailingUrlPunctuation(url: string) {
    let core = url;
    let trailing = '';
    while (/[),.!?;:]$/.test(core)) {
        trailing = core.slice(-1) + trailing;
        core = core.slice(0, -1);
    }
    return {core, trailing};
}

function renderActivityInlineMarkdownWithAutoLinks(value: string) {
    const autoLinkPattern = /\bhttps?:\/\/[^\s<>"'`]+/g;
    let html = '';
    let cursor = 0;
    let match = autoLinkPattern.exec(value);

    while (match) {
        html += renderActivityInlineMarkdown(value.slice(cursor, match.index));

        const {core, trailing} = splitTrailingUrlPunctuation(match[0]);
        const safeUrl = sanitizeActivityLinkUrl(core);
        if (safeUrl) {
            html += `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(core)}</a>`;
            html += renderActivityInlineMarkdown(trailing);
        } else {
            html += renderActivityInlineMarkdown(match[0]);
        }

        cursor = match.index + match[0].length;
        match = autoLinkPattern.exec(value);
    }

    html += renderActivityInlineMarkdown(value.slice(cursor));
    return html;
}

function renderActivityInlineMarkdownWithLinks(value: string) {
    const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
    let html = '';
    let cursor = 0;
    let match = linkPattern.exec(value);

    while (match) {
        html += renderActivityInlineMarkdownWithAutoLinks(value.slice(cursor, match.index));

        const linkText = match[1];
        const safeUrl = sanitizeActivityLinkUrl(match[2]);
        if (safeUrl) {
            html += `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${renderActivityInlineMarkdown(linkText)}</a>`;
        } else {
            html += renderActivityInlineMarkdownWithAutoLinks(match[0]);
        }

        cursor = match.index + match[0].length;
        match = linkPattern.exec(value);
    }

    html += renderActivityInlineMarkdownWithAutoLinks(value.slice(cursor));
    return html;
}

export function renderActivityMarkdown(value: string) {
    const lines = value.split(/\r?\n/);
    const blocks: string[] = [];
    const paragraphLines: string[] = [];
    const listItems: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const flushParagraph = () => {
        if (!paragraphLines.length) {
            return;
        }
        blocks.push(renderActivityInlineMarkdownWithLinks(paragraphLines.join('\n')).replace(/\n/g, '<br/>'));
        paragraphLines.length = 0;
    };

    const flushList = () => {
        if (!listType || !listItems.length) {
            return;
        }
        const itemsHtml = listItems.map((item) => `<li>${renderActivityInlineMarkdownWithLinks(item)}</li>`).join('');
        blocks.push(`<${listType}>${itemsHtml}</${listType}>`);
        listItems.length = 0;
        listType = null;
    };

    for (const line of lines) {
        const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
        const bulletMatch = line.match(/^\s*[-+*]\s+(.+)$/);
        const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);

        if (headingMatch) {
            flushParagraph();
            flushList();
            blocks.push(`<strong>${renderActivityInlineMarkdownWithLinks(headingMatch[1])}</strong>`);
            continue;
        }

        if (bulletMatch) {
            flushParagraph();
            if (listType !== 'ul') {
                flushList();
                listType = 'ul';
            }
            listItems.push(bulletMatch[1]);
            continue;
        }

        if (orderedMatch) {
            flushParagraph();
            if (listType !== 'ol') {
                flushList();
                listType = 'ol';
            }
            listItems.push(orderedMatch[1]);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        flushList();
        paragraphLines.push(line);
    }

    flushParagraph();
    flushList();

    return blocks.join('');
}

