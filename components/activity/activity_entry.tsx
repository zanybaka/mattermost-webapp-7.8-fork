// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import ActivityLink from './activity_link';

// LHS entry only — full Activity UI lives at /:team/activity (center channel).
export default function ActivityEntry() {
    return <ActivityLink/>;
}
