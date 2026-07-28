// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {memo, useCallback} from 'react';
import classNames from 'classnames';
import {useIntl} from 'react-intl';
import {Link, useRouteMatch, useLocation, matchPath} from 'react-router-dom';

import {t} from 'utils/i18n';

import './activity_link.scss';

function ActivityLink() {
    const {formatMessage} = useIntl();
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const inActivity = matchPath(pathname, {path: '/:team/activity'}) != null;

    const openActivity = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <ul className='SidebarActivity NavGroupContent nav nav-pills__container'>
            <li
                id={'sidebar-activity-button'}
                className={classNames('SidebarChannel', {
                    active: inActivity,
                })}
                tabIndex={-1}
            >
                <Link
                    onClick={openActivity}
                    to={`${url}/activity`}
                    id='sidebarItem_activity'
                    draggable='false'
                    className={classNames('SidebarLink sidebar-item', {
                        active: inActivity,
                    })}
                    tabIndex={0}
                >
                    <span className='icon'>
                        <i className='icon icon-bell-outline'/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            {formatMessage({id: t('activity.sidebarLink'), defaultMessage: 'Activity'})}
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
}

export default memo(ActivityLink);
