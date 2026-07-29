// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useHistory} from 'react-router-dom';

import {getCurrentTeam, getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {selectLhsItem} from 'actions/views/lhs';
import {suppressRHS, unsuppressRHS} from 'actions/views/rhs';
import {LhsItemType, LhsPage} from 'types/store/lhs';
import {getHistory} from 'utils/browser_history';

import activityAggregationService from './aggregationService';
import type {ActivityLoadContext} from './interfaces';
import type {ActivityItem, ActivityPage, ActivityEventKind} from './types';
import ActivityReactionMessage from './activity_reaction_message';
import {renderActivityMarkdown} from './activityMarkdown';
import {
    ACTIVITY_FILTER_KINDS,
    ACTIVITY_KIND_ICONS,
    formatActivityTime,
    getActivityActorName,
    getActivityDayBadgeLabel,
    getActivityDisplayKind,
    getActivityKindMetaTitle,
    getActivityMessage,
    getActivityPanelItemId,
    getActivityTitle,
    isActivityHighlightedItem,
    isReminderLikeItem,
} from './activityDisplay';

import './activity_view.scss';

const DEFAULT_PAGE_SIZE = 50;

const ACTIVITY_FILTERS_STORAGE_KEY = 'mm-webapp-activity-filters-v1';
const ACTIVITY_HIDDEN_ITEMS_STORAGE_KEY_PREFIX = 'mm-webapp-hidden-activity-item-ids';

type PersistedActivityFilters = {
    kindFilters?: Partial<Record<ActivityEventKind, boolean>>;
    highlightedOnly?: boolean;
    hideThreadItems?: boolean;
    hideMentionReactionItems?: boolean;
};

function getHiddenActivityStorageKey(serverId: string, userId: string) {
    const server = (serverId || 'global').trim() || 'global';
    const user = (userId || 'anonymous').trim() || 'anonymous';
    return `${ACTIVITY_HIDDEN_ITEMS_STORAGE_KEY_PREFIX}:${server}:${user}`;
}

function setSidebarSectionVisibilityByPath(pathFragment: string, hidden: boolean) {
    const sidebar = document.getElementById('sidebar-left');
    if (!sidebar) {
        return;
    }

    const links = sidebar.querySelectorAll<HTMLAnchorElement>(`a[href*="${pathFragment}"]`);
    links.forEach((link) => {
        const container = (link.closest('li, div.SidebarNavItem, div[class*="sidebarItem"]') as HTMLElement | null) || link;
        if (hidden) {
            container.style.display = 'none';
            return;
        }
        container.style.removeProperty('display');
    });
}

function applyNativeSidebarSectionVisibility(hideThreadItems: boolean, hideMentionReactionItems: boolean) {
    setSidebarSectionVisibilityByPath('/threads', hideThreadItems);
    // Desktop hides Insights via href*=/activity; our Activity route is also /activity —
    // only hide Insights, never the Activity tab itself.
    setSidebarSectionVisibilityByPath('/activity-and-insights', hideMentionReactionItems);
}

export default function ActivityView() {
    const dispatch = useDispatch();
    const history = useHistory();

    const currentTeam = useSelector(getCurrentTeam);
    const teamId = useSelector(getCurrentTeamId) || 'local';
    const userId = useSelector(getCurrentUserId) || '';
    const teamName = currentTeam?.name || '';

    const context = useMemo((): ActivityLoadContext => ({
        serverId: teamId,
        userId,
        pageSize: DEFAULT_PAGE_SIZE,
    }), [teamId, userId]);

    const [items, setItems] = useState<ActivityItem[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState(true);

    const [loadedAvatarKeys, setLoadedAvatarKeys] = useState<Set<string>>(new Set());
    const [failedAvatarKeys, setFailedAvatarKeys] = useState<Set<string>>(new Set());

    const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());

    const [kindFilters, setKindFilters] = useState<Record<ActivityEventKind, boolean>>(() => (
        ACTIVITY_FILTER_KINDS.reduce((acc, kind) => {
            acc[kind] = true;
            return acc;
        }, {} as Record<ActivityEventKind, boolean>)
    ));
    const [highlightedOnlyFilter, setHighlightedOnlyFilter] = useState(false);
    const [hideThreadItems, setHideThreadItems] = useState(false);
    const [hideMentionReactionItems, setHideMentionReactionItems] = useState(false);
    const [filtersHydrated, setFiltersHydrated] = useState(false);

    const queryInputRef = useRef<HTMLInputElement>(null);

    const canLoad = Boolean(userId);

    const persistActivityFilters = useCallback((next: PersistedActivityFilters) => {
        try {
            window.localStorage.setItem(ACTIVITY_FILTERS_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // ignore persistence errors
        }
    }, []);

    const persistHiddenActivityItemIds = useCallback((next: Set<string>) => {
        try {
            window.localStorage.setItem(getHiddenActivityStorageKey(teamId, userId), JSON.stringify(Array.from(next)));
        } catch {
            // ignore persistence errors
        }
    }, [teamId, userId]);

    const hydrateHiddenActivityItemIdsFromStorage = useCallback(() => {
        try {
            const raw = window.localStorage.getItem(getHiddenActivityStorageKey(teamId, userId));
            if (!raw) {
                setHiddenItemIds(new Set());
                return;
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                setHiddenItemIds(new Set());
                return;
            }

            setHiddenItemIds(new Set(parsed.filter((value) => typeof value === 'string')));
        } catch {
            setHiddenItemIds(new Set());
        }
    }, [teamId, userId]);

    const hydrateActivityFiltersFromStorage = useCallback(() => {
        try {
            const raw = window.localStorage.getItem(ACTIVITY_FILTERS_STORAGE_KEY);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw) as PersistedActivityFilters;
            if (parsed.kindFilters) {
                setKindFilters((prev) => {
                    const next = {...prev};
                    ACTIVITY_FILTER_KINDS.forEach((kind) => {
                        const value = parsed.kindFilters?.[kind];
                        if (typeof value === 'boolean') {
                            next[kind] = value;
                        }
                    });
                    return next;
                });
            }
            if (typeof parsed.highlightedOnly === 'boolean') {
                setHighlightedOnlyFilter(parsed.highlightedOnly);
            }
            if (typeof parsed.hideThreadItems === 'boolean') {
                setHideThreadItems(parsed.hideThreadItems);
            }
            if (typeof parsed.hideMentionReactionItems === 'boolean') {
                setHideMentionReactionItems(parsed.hideMentionReactionItems);
            }
        } catch {
            // ignore malformed persisted values
        }
    }, []);

    const loadInitial = useCallback(async () => {
        if (!userId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const page = await activityAggregationService.loadInitial(context) as ActivityPage;
            setItems(page.items || []);
            setHasMore(page.hasMore !== false);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [context, userId]);

    const loadOlder = useCallback(async () => {
        if (!userId || loading) {
            return;
        }
        const state = activityAggregationService.getState(context.serverId, context.userId);
        if (!state) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const page = await activityAggregationService.loadOlder(context, state) as ActivityPage;
            setItems(page.items || []);
            setHasMore(page.hasMore !== false);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [context, loading, userId]);

    const refresh = useCallback(async () => {
        if (!userId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const state = activityAggregationService.getState(context.serverId, context.userId) || undefined;
            const page = await activityAggregationService.refresh(context, state) as ActivityPage;
            setItems(page.items || []);
            setHasMore(page.hasMore !== false);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [context, userId]);

    const searchLocal = useCallback(async (nextQuery: string) => {
        if (!userId) {
            return;
        }
        const trimmed = nextQuery.trim();
        if (!trimmed) {
            refresh();
            return;
        }

        setLoading(true);
        setError('');
        try {
            const state = activityAggregationService.getState(context.serverId, context.userId);
            const baseItems = state?.items || items;
            const result = activityAggregationService.searchLocal(trimmed, baseItems);
            setItems(Array.isArray(result) ? result : []);
            setHasMore(false);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [context.serverId, context.userId, items, refresh, userId]);

    const hideItem = useCallback((itemId: string) => {
        setHiddenItemIds((prev) => {
            if (prev.has(itemId)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(itemId);
            persistHiddenActivityItemIds(next);
            return next;
        });
    }, [persistHiddenActivityItemIds]);

    const openItem = useCallback((item: ActivityItem) => {
        if (!teamName) {
            return;
        }
        if (item.postId) {
            getHistory().push(`/${teamName}/pl/${item.postId}`);
            return;
        }
        if (item.threadId) {
            getHistory().push(`/${teamName}/threads/${item.threadId}`);
        }
    }, [teamName]);

    const allKindsEnabled = useMemo(() => {
        return ACTIVITY_FILTER_KINDS.every((kind) => kindFilters[kind] !== false);
    }, [kindFilters]);

    const filteredItems = useMemo(() => {
        const sorted = [...items].sort((a, b) => b.eventTs - a.eventTs);

        return sorted.filter((item) => {
            const itemId = getActivityPanelItemId(item);
            if (hiddenItemIds.has(itemId)) {
                return false;
            }

            const kindForDisplay = getActivityDisplayKind(item) as ActivityEventKind;
            if (kindFilters[kindForDisplay] === false) {
                return false;
            }

            if (highlightedOnlyFilter && !isActivityHighlightedItem(item)) {
                return false;
            }

            return true;
        });
    }, [hiddenItemIds, highlightedOnlyFilter, items, kindFilters]);

    const feedElements = useMemo(() => {
        let previousDayLabel = '';
        const elements: React.ReactNode[] = [];

        filteredItems.forEach((item) => {
            const actorName = getActivityActorName(item);
            const title = getActivityTitle(item, actorName);
            const message = getActivityMessage(item, actorName);
            const reminderLike = isReminderLikeItem(item, actorName);
            const kindForDisplay = (reminderLike ? 'reminder' : item.eventKind) as ActivityEventKind;

            const dayLabel = getActivityDayBadgeLabel(item.eventTs);
            if (dayLabel && dayLabel !== previousDayLabel) {
                previousDayLabel = dayLabel;
                elements.push(
                    <div
                        key={`day:${dayLabel}:${item.eventTs}`}
                        className='desktop-activity-day-separator'
                    >
                        <span className='desktop-activity-day-separator-badge'>
                            {dayLabel}
                        </span>
                    </div>,
                );
            }

            const hasPersonalMention = item.sourceRef?.personalMention === 'true';
            const hasBroadcastMention = item.sourceRef?.broadcastMention === 'true';
            const isDM = kindForDisplay === 'dm';

            const reminderClass = reminderLike ? ' desktop-activity-item--reminder' : '';
            const personalMentionClass = !isDM && hasPersonalMention ? ' desktop-activity-item--mention-personal' : '';
            const broadcastMentionClass = !isDM && !hasPersonalMention && hasBroadcastMention ? ' desktop-activity-item--mention-broadcast' : '';

            const groupMembers = (item.sourceRef?.groupMembers || '').trim();
            const channelName = (item.sourceRef?.channelName || '').trim();
            const shouldShowChannelMeta = (item.eventKind === 'mention' || item.eventKind === 'thread_reply') && channelName;

            const unreadDot = isDM ? true : (hasPersonalMention && !hasBroadcastMention);

            const itemId = getActivityPanelItemId(item);
            const avatarKey = `${item.canonicalId || itemId}:${(item.actorAvatarUrl || '').trim()}`;
            const avatarVisible = loadedAvatarKeys.has(avatarKey);
            const avatarFailed = failedAvatarKeys.has(avatarKey);

            const fallbackBodyText = message || item.previewText || '(no preview)';

            elements.push(
                <div
                    key={itemId}
                    className={`desktop-activity-item${reminderClass}${personalMentionClass}${broadcastMentionClass}`}
                    data-kind={kindForDisplay}
                >
                    <div
                        className='desktop-activity-item-body desktop-activity-item-clickable'
                        role='button'
                        tabIndex={0}
                        data-post-id={item.postId || ''}
                        data-thread-id={item.threadId || ''}
                        data-channel-id={item.channelId || ''}
                        onClick={() => openItem(item)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openItem(item);
                            }
                        }}
                    >
                        <span className='desktop-activity-avatar-slot'>
                            {item.actorAvatarUrl && !avatarFailed ? (
                                <img
                                    className={`desktop-activity-avatar${avatarVisible ? ' desktop-activity-avatar--visible' : ''}`}
                                    src={item.actorAvatarUrl}
                                    alt=''
                                    loading='lazy'
                                    onLoad={() => {
                                        setLoadedAvatarKeys((prev) => {
                                            const next = new Set(prev);
                                            next.add(avatarKey);
                                            return next;
                                        });
                                    }}
                                    onError={() => {
                                        setFailedAvatarKeys((prev) => {
                                            const next = new Set(prev);
                                            next.add(avatarKey);
                                            return next;
                                        });
                                    }}
                                />
                            ) : null}
                            <span className='desktop-activity-avatar-fallback'>
                                <i className={`icon ${ACTIVITY_KIND_ICONS[kindForDisplay] || 'icon-account-outline'}`} aria-hidden='true'/>
                            </span>
                        </span>

                        <div className='desktop-activity-item-content'>
                            <div className='desktop-activity-title-row'>
                                <div className='desktop-activity-actor'>
                                    <strong>{title}</strong>
                                </div>

                                <span className='desktop-activity-item-meta'>
                                    {item.eventKind === 'gm' && groupMembers ? (
                                        <span className='desktop-activity-gm-meta'>
                                            {groupMembers}
                                        </span>
                                    ) : null}
                                    {shouldShowChannelMeta ? (
                                        <span className='desktop-activity-channel-meta'>
                                            {channelName}
                                        </span>
                                    ) : null}
                                    {unreadDot ? (
                                        <span className='desktop-activity-unread-dot' title='Unread'/>
                                    ) : null}
                                    <span className='desktop-activity-kind' title={getActivityKindMetaTitle(kindForDisplay)}>
                                        <i className={`icon ${ACTIVITY_KIND_ICONS[kindForDisplay]}`} aria-hidden='true'/>
                                    </span>
                                    <span className='desktop-activity-item-time'>
                                        {formatActivityTime(item.eventTs)}
                                    </span>
                                    <button
                                        className='desktop-activity-item-hide'
                                        type='button'
                                        aria-label='Hide'
                                        title='Hide'
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            hideItem(itemId);
                                        }}
                                    >
                                        ×
                                    </button>
                                </span>
                            </div>
                            {item.eventKind === 'reaction' ? (
                                <ActivityReactionMessage
                                    item={item}
                                    fallbackText={fallbackBodyText}
                                />
                            ) : (
                                <div
                                    className='desktop-activity-message'

                                    // eslint-disable-next-line react/no-danger
                                    dangerouslySetInnerHTML={{__html: renderActivityMarkdown(fallbackBodyText)}}
                                />
                            )}
                        </div>
                    </div>
                </div>,
            );
        });

        return elements;
    }, [failedAvatarKeys, filteredItems, hideItem, loadedAvatarKeys, openItem]);

    useEffect(() => {
        dispatch(suppressRHS);
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Activity));
        return () => {
            dispatch(unsuppressRHS);
        };
    }, [dispatch]);

    useEffect(() => {
        hydrateActivityFiltersFromStorage();
        hydrateHiddenActivityItemIdsFromStorage();
        setFiltersHydrated(true);
    }, [hydrateActivityFiltersFromStorage, hydrateHiddenActivityItemIdsFromStorage]);

    useEffect(() => {
        if (!filtersHydrated) {
            return;
        }
        applyNativeSidebarSectionVisibility(hideThreadItems, hideMentionReactionItems);
        persistActivityFilters({
            kindFilters,
            highlightedOnly: highlightedOnlyFilter,
            hideThreadItems,
            hideMentionReactionItems,
        });
    }, [filtersHydrated, hideMentionReactionItems, hideThreadItems, highlightedOnlyFilter, kindFilters, persistActivityFilters]);

    useEffect(() => {
        loadInitial();
        queryInputRef.current?.focus();
    }, [loadInitial]);

    useEffect(() => {
        setLoadedAvatarKeys(new Set());
        setFailedAvatarKeys(new Set());
        setHasMore(true);
    }, [teamId]);

    return (
        <div className='app__content ActivityView'>
            <section
                id='desktop-activity-content-panel'
                className='visible'
            >
                <div className='desktop-activity-header'>
                    <div className='desktop-activity-header-left'>
                        <h2 className='desktop-activity-title'>
                            {'Activity'}
                        </h2>
                        <div className='desktop-activity-header-toggles'>
                            <label className='desktop-activity-header-toggle'>
                                <input
                                    type='checkbox'
                                    checked={!hideThreadItems}
                                    onChange={(e) => setHideThreadItems(!e.target.checked)}
                                />
                                <span>{'Threads'}</span>
                            </label>
                            <label className='desktop-activity-header-toggle'>
                                <input
                                    type='checkbox'
                                    checked={!hideMentionReactionItems}
                                    onChange={(e) => setHideMentionReactionItems(!e.target.checked)}
                                />
                                <span>{'Mentions + Reactions'}</span>
                            </label>
                        </div>
                    </div>
                    <div className='desktop-activity-actions'>
                        <button
                            type='button'
                            aria-label='Refresh'
                            title='Refresh'
                            disabled={!canLoad || loading}
                            onClick={refresh}
                        >
                            <i className='icon icon-refresh' aria-hidden='true'/>
                        </button>
                        <button
                            type='button'
                            aria-label='Close'
                            title='Close'
                            onClick={() => history.goBack()}
                        >
                            <i className='icon icon-close' aria-hidden='true'/>
                        </button>
                    </div>
                </div>

                <div className='desktop-activity-search'>
                    <div className='desktop-activity-search-row'>
                        <input
                            ref={queryInputRef}
                            type='text'
                            placeholder='Filter activity...'
                            value={query}
                            disabled={!canLoad}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    const trimmed = (query || '').trim();
                                    if (trimmed) {
                                        setQuery('');
                                        return;
                                    }

                                    refresh();
                                    return;
                                }

                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    searchLocal(query);
                                }
                            }}
                        />
                        <button
                            type='button'
                            onClick={() => queryInputRef.current?.focus()}
                        >
                            {'Filter'}
                        </button>
                        <div className='desktop-activity-filters'>
                            <button
                                type='button'
                                className={`desktop-activity-filter-btn desktop-activity-filter-btn--all${allKindsEnabled ? ' is-active' : ''}`}
                                aria-pressed={allKindsEnabled ? 'true' : 'false'}
                                onClick={() => {
                                    const nextAll = !allKindsEnabled;
                                    setKindFilters((prev) => {
                                        const next = {...prev};
                                        ACTIVITY_FILTER_KINDS.forEach((kind) => {
                                            next[kind] = nextAll;
                                        });
                                        return next;
                                    });
                                }}
                            >
                                {'All'}
                            </button>
                            {ACTIVITY_FILTER_KINDS.map((kind) => {
                                const isActive = kindFilters[kind] !== false;
                                return (
                                    <button
                                        key={kind}
                                        type='button'
                                        className={`desktop-activity-filter-btn${isActive ? ' is-active' : ''}`}
                                        aria-pressed={isActive ? 'true' : 'false'}
                                        title={getActivityKindMetaTitle(kind)}
                                        onClick={() => setKindFilters((prev) => ({...prev, [kind]: !(prev[kind] !== false)}))}
                                    >
                                        <i className={`icon ${ACTIVITY_KIND_ICONS[kind]}`} aria-hidden='true'/>
                                    </button>
                                );
                            })}
                        </div>
                        <label
                            className='desktop-activity-highlight-filter'
                            title='Show only important activity'
                        >
                            <input
                                type='checkbox'
                                checked={highlightedOnlyFilter}
                                onChange={() => setHighlightedOnlyFilter((prev) => !prev)}
                            />
                            <span className='desktop-activity-highlight-filter-label'>
                                {'Important'}
                            </span>
                        </label>
                    </div>
                </div>

                <div className='desktop-activity-feed'>
                    {error && !filteredItems.length ? (
                        <div className='desktop-activity-error'>
                            {error}
                        </div>
                    ) : null}
                    {loading && !filteredItems.length ? (
                        <div className='desktop-activity-loading'>
                            {'Loading...'}
                        </div>
                    ) : null}
                    {!loading && !error && !filteredItems.length ? (
                        <div className='desktop-activity-empty'>
                            {'No activity yet'}
                        </div>
                    ) : null}

                    {feedElements}

                    {hasMore ? (
                        <div className='desktop-activity-loading desktop-activity-load-more-row'>
                            <button
                                className='desktop-activity-load-more'
                                type='button'
                                disabled={loading || !canLoad}
                                onClick={loadOlder}
                            >
                                {'Load more'}
                            </button>
                        </div>
                    ) : null}

                    {loading && filteredItems.length ? (
                        <div className='desktop-activity-loading'>
                            {'Loading...'}
                        </div>
                    ) : null}
                </div>
            </section>
        </div>
    );
}
