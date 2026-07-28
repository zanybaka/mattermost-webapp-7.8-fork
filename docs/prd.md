# PRD: Activity tab in Mattermost Web App (7.8 fork)

## Goal
Port the desktop **Activity** experience into the webapp fork (`release-7.8-fork`) so browser users of the target Mattermost 7.8 deployment get the same aggregated feed.

## Decisions (interview 2026-07-28)

| Topic | Decision |
| --- | --- |
| Scope | Full parity with desktop: mentions, threads, reactions, DMs/GMs, reminders, filters, hide item, search, load more |
| UI placement | Same as desktop: left sidebar item opening the Activity panel (full center channel) |
| Native Threads / Mentions | Hide native sidebar/header items like desktop (avoid duplication) |
| Code strategy | Prefer clean webapp-native code over 1:1 IPC/desktop copy; reuse desktop logic where it stays clear |
| Audience | Internal target Mattermost only (not stock upstream PR) |
| Reminders | Keep; soft-fallback if reminders API 404 (same as desktop) |
| Feature flag | Always enabled in this fork |
| Delivery | Local `dev-server:remote` first → land on fork → GitHub `release-fork` → optional sandbox/k8s host |
| Done | User confirms it works locally; then GitHub release is cut |

## Non-goals (v1)
- Stock Mattermost / public upstream PR
- Desktop Electron packaging changes
- Sandbox/k8s project creation before local confirmation

## Success
1. On `http://localhost:9005` against the configured remote (see `docs/DEV.md` / `local.env`): Activity works end-to-end; click opens the right chat/post/thread.
2. User confirms.
3. Tag + `release-fork` publishes `mattermost-webapp-*.zip`.
4. (Follow-up) Host build in your sandbox/k8s per `docs/DEV.md`.

## Reference
- Desktop Activity sources: `src/common/activity/*`, `src/main/activity/*`, desktop preload Activity panel
- Webapp: `components/activity/*`, branch `release-7.8-fork`
