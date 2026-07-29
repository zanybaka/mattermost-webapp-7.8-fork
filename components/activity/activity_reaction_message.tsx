// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {memo, useState} from 'react';

import {renderActivityMarkdown, sanitizeActivityLinkUrl} from './activityMarkdown';
import type {ActivityItem} from './types';

type Props = {
    item: ActivityItem;
    fallbackText: string;
};

function ActivityReactionMessage({item, fallbackText}: Props) {
    const [imageFailed, setImageFailed] = useState(false);

    const emojiName = (item.sourceRef?.emoji || '').trim();
    const emojiImageUrl = sanitizeActivityLinkUrl((item.sourceRef?.emojiImageUrl || '').trim());
    const emojiShortcode = emojiName ? `:${emojiName}:` : '';
    const fallbackLabel = fallbackText || emojiShortcode || '(no preview)';

    if (!emojiName || !emojiImageUrl || imageFailed) {
        return (
            <div
                className='desktop-activity-message'

                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{__html: renderActivityMarkdown(fallbackLabel)}}
            />
        );
    }

    return (
        <div className='desktop-activity-message'>
            <span className='desktop-activity-reaction'>
                <img
                    className='desktop-activity-reaction-emoji'
                    src={emojiImageUrl}
                    alt={emojiShortcode}
                    loading='lazy'
                    onError={() => setImageFailed(true)}
                />
            </span>
        </div>
    );
}

export default memo(ActivityReactionMessage);
