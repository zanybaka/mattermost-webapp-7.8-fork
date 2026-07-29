// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage} from 'react-intl';

import Markdown from 'components/markdown';

import type {ActivityItem} from './types';

type Props = {
    item: ActivityItem;
    text: string;
};

const MARKDOWN_OPTIONS = {
    singleline: false,
    mentionHighlight: false,
    atMentions: true,
};

function ActivityReactionMessage({emojiName, imageUrl, text}: {emojiName: string; imageUrl: string; text: string}) {
    const [imageFailed, setImageFailed] = useState(false);
    const shortcode = `:${emojiName}:`;

    return (
        <span className='desktop-activity-reaction'>
            {imageUrl && !imageFailed ? (
                <img
                    className='desktop-activity-reaction-emoji'
                    src={imageUrl}
                    alt={shortcode}
                    loading='lazy'
                    onError={() => setImageFailed(true)}
                />
            ) : null}
            <span className='desktop-activity-reaction-shortcode'>
                {text || shortcode}
            </span>
        </span>
    );
}

export default function ActivityMessage({item, text}: Props) {
    const emojiName = (item.sourceRef?.emoji || '').trim();

    if (!text && !emojiName) {
        return (
            <span className='desktop-activity-message-empty'>
                <FormattedMessage
                    id='activity.noPreview'
                    defaultMessage='(no preview)'
                />
            </span>
        );
    }

    if (item.eventKind === 'reaction' && emojiName) {
        return (
            <ActivityReactionMessage
                emojiName={emojiName}
                imageUrl={(item.sourceRef?.emojiImageUrl || '').trim()}
                text={text}
            />
        );
    }

    return (
        <Markdown
            message={text}
            options={MARKDOWN_OPTIONS}
        />
    );
}
