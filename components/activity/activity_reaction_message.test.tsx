// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';

import ActivityReactionMessage from './activity_reaction_message';
import type {ActivityItem} from './types';

const UNSAFE_SCRIPT_URL = `java${'script'}:alert(1)`;

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
    return {
        canonicalId: '',
        eventKind: 'reaction',
        serverId: 'server-1',
        targetUserId: 'user-1',
        eventTs: 100,
        previewText: 'preview',
        ...overrides,
    };
}

describe('ActivityReactionMessage', () => {
    test('renders the emoji image without inline event handlers', () => {
        const {container} = render(
            <ActivityReactionMessage
                item={makeItem({sourceRef: {emoji: 'smile', emojiImageUrl: '/api/v4/emoji/1/image'}})}
                fallbackText='reacted'
            />,
        );

        const image = screen.getByAltText(':smile:');
        expect(image).toHaveAttribute('src', '/api/v4/emoji/1/image');
        expect(image.outerHTML).not.toContain('onerror');
        expect(container.textContent).toBe('');
    });

    test('renders markdown when there is no emoji', () => {
        const {container} = render(
            <ActivityReactionMessage
                item={makeItem()}
                fallbackText='**hi**'
            />,
        );

        expect(container.innerHTML).toContain('<strong>hi</strong>');
    });

    test('renders the shortcode when the emoji image url is unsafe', () => {
        const {container} = render(
            <ActivityReactionMessage
                item={makeItem({sourceRef: {emoji: 'smile', emojiImageUrl: UNSAFE_SCRIPT_URL}})}
                fallbackText=''
            />,
        );

        expect(container.textContent).toBe(':smile:');
        expect(container.querySelector('img')).toBeNull();
    });

    test('falls back to the shortcode when the image fails to load', () => {
        const {container} = render(
            <ActivityReactionMessage
                item={makeItem({sourceRef: {emoji: 'smile', emojiImageUrl: '/api/v4/emoji/1/image'}})}
                fallbackText=''
            />,
        );

        fireEvent.error(screen.getByAltText(':smile:'));

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe(':smile:');
    });
});
