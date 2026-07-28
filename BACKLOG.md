# BACKLOG: Activity Tab (Webapp 7.8 fork)

Source PRD: `docs/prd.md`. Desktop reference: desktop fork Activity modules / preload panel.

Scheduling: **explicit-deps**. Pick next open `- [ ]` with satisfied `Depends on`.

## Phase 1 — Core model & API (no UI)

- [x] ACT-001 Port Activity types, canonical IDs, and merge engine
    Task Context: Copy/adapt desktop `src/common/activity/{types,canonical,merge,interfaces,persistence}.ts` into webapp (e.g. `components/activity/` or `packages/`-adjacent module). Drop Electron/IPC-only bits. Keep target-server-compatible canonical keys and merge ordering (`event_ts DESC`). Prefer clear webapp module layout over 1:1 path mirroring. No feature flag.
    Task DOD: Shared Activity types and merge/canonical helpers compile in webapp; unit tests ported or rewritten for merge/canonical; no IPC imports.
    Priority: P1
    Size: M
    Depends on:
    Agent: auto
    Verify: typecheck + unit tests for merge/canonical

- [x] ACT-002 Port source adapters with Mattermost 7.8 / older-search quirks
    Task Context: Port desktop adapters (mentions, threads, reactions via `posts/search`, dm/gm, reminders) to browser fetch/session cookies. Preserve quirks: no `/posts/unread` for reactions; older mention search semantics + broadcast `@all/@channel/@here` merge; reminders soft-fallback on 404 — do not drop any source. Always-on.
    Task DOD: Each adapter returns ActivityItems for a logged-in session (or documented empty+error envelope); reminders never hard-fail the feed; unit/contract tests cover reaction search path and reminders 404 fallback.
    Priority: P1
    Size: L
    Depends on: ACT-001
    Agent: auto
    Verify: unit tests + manual smoke via API with `dev-server:remote` session if available

- [x] ACT-003 Aggregation service without Electron IPC
    Task Context: Port `activityAggregationService` (+ state/cursor/checkpoint as needed) to run in the browser/redux layer. Replace desktop persistence with `localStorage`/indexedDB suitable for webapp. Refresh, load more, local search. Simplify freely vs desktop IPC.
    Task DOD: Service can load first page + load more + refresh for all sources; errors per-source don’t blank the whole feed; state survives reload for last snapshot (bounded).
    Priority: P1
    Size: L
    Depends on: ACT-002
    Agent: auto
    Verify: unit tests for aggregation pagination; typecheck

## Phase 2 — UI & navigation

- [x] ACT-004 Sidebar Activity entry and hide native Threads/Mentions
    Task Context: Inject Activity into left sidebar like desktop. Hide native Threads and Mentions controls in this fork (always on). Match desktop placement/UX cues as closely as practical in 7.8 webapp.
    Task DOD: Activity item visible in sidebar on team channel view; native Threads/Mentions hidden; no console errors; works under `dev-server:remote`.
    Priority: P1
    Size: M
    Depends on: ACT-003
    Agent: auto
    Verify: manual UI on localhost:9005

- [x] ACT-005 Activity panel UI (feed, filters, search, hide, load more)
    Task Context: Port desktop Activity panel UX into webapp React 17 + styles. Full parity: chronological feed, filters, local search, hide item (x), Load more, Refresh. Always enabled.
    Task DOD: Panel opens from sidebar entry as full center view; all listed controls work against aggregation service; empty/error states are usable.
    Priority: P1
    Size: L
    Depends on: ACT-004
    Agent: auto
    Verify: manual UI checklist via localhost against configured remote

- [x] ACT-006 Click-through navigation to posts/threads/channels
    Task Context: On item click, navigate inside the same Mattermost UI via `history.push` (or webapp helpers) to `/pl/…`, thread, or channel — equivalent to desktop history push. Prefer simplest correct webapp API.
    Task DOD: Clicking mention/thread/reaction/DM/GM/reminder opens the correct destination without leaving the app shell; back/forward still sane.
    Priority: P1
    Size: M
    Depends on: ACT-005
    Agent: auto
    Verify: manual click matrix for each activity kind

## Phase 3 — Verify & ship

- [ ] ACT-007 Local acceptance (`dev-server:remote`)
    Task Context: End-to-end verify against configured remote (see `docs/DEV.md` / `local.env`): login, Activity load, filters, hide, search, load more, all sources including reminders fallback, click-through. User must confirm before release. Risk: P1, approved 2026-07-28 (PRD).
    Task DOD: User explicitly confirms Activity works on localhost against the remote; known issues listed in `CHANGELOG.md` or task notes if any.
    Priority: P0
    Size: M
    Depends on: ACT-006
    Agent: human
    Verify: user confirmation

- [ ] ACT-008 GitHub release via `release-fork`
    Task Context: After ACT-007 confirmation, tag `7.8.0-fork-releaseN`, run Actions `release-fork`, publish zip artifact. Update README/CHANGELOG as needed.
    Task DOD: GitHub Release exists with `mattermost-webapp-*.zip`; tag pushed; README release notes accurate.
    Priority: P1
    Size: S
    Depends on: ACT-007
    Agent: human
    Verify: release URL + artifact present

- [ ] ACT-009 Host build in sandbox / Kubernetes
    Task Context: After GitHub release (or from local dist), deploy/host the webapp build per `docs/DEV.md` (same-origin static + SiteURL). Do not block local acceptance.
    Task DOD: Hosted URL opens the forked webapp; documented in README/DEV; deploy steps reproducible.
    Priority: P2
    Size: L
    Depends on: ACT-008
    Agent: auto
    Verify: hosted URL loads Activity against intended backend
