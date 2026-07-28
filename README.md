# Mattermost Web App (fork)

Fork of Mattermost webapp **v7.8** (base tag `v7.8.3` / package `7.8.0`) with an **Activity** feed (mentions, threads, reactions, DMs/GMs, reminders) in the left sidebar / center channel.[^1]

[^1]: Upstream readme snapshot: [README.Original.md](README.Original.md). Upstream: [mattermost/mattermost-webapp](https://github.com/mattermost/mattermost-webapp) (archived; monorepo: [mattermost/mattermost](https://github.com/mattermost/mattermost)).

Companion desktop Activity work lives in a separate desktop fork (`release-5.10-fork` line).

## What’s in this fork

* **Activity** — full-center view at `/:team/activity`, desktop-parity UI/filters (see `components/activity/`).
* **Dev proxy helper** — `npm run dev-server:remote` reads gitignored `local.env` (`MM_SERVICESETTINGS_SITEURL`) and proxies API to that host with cookie rewrite for `localhost`.
* **Login autofill fix** — login submit uses DOM field values (password managers).
* **Boards stub** — local `boards/` so webpack builds without focalboard checkout.
* Native Threads LHS + Mentions header control are hidden in this fork (Activity replaces that UX).

## Local development

See **[docs/DEV.md](docs/DEV.md)** (copy `local.env.example` → `local.env`, set `MM_SERVICESETTINGS_SITEURL`, then `npm run dev-server:remote`).

```bash
cp local.env.example local.env
# edit local.env
npm ci
npm run dev-server:remote
# http://localhost:9005
```

## Build

```bash
npm ci
npm run build
```

Output: `dist/` (static client assets).

### GitHub Actions (`release-fork`)

`package.json` version stays `7.8.0`. Public release number = git tag `7.8.0-fork-releaseN`. Workflow is **manual** (`workflow_dispatch`).

```bash
git checkout release-7.8-fork
git pull origin release-7.8-fork
git tag 7.8.0-fork-releaseN
git push origin release-7.8-fork 7.8.0-fork-releaseN
# Actions → release-fork → Run workflow (branch + tag)
```

Deploy: unpack the release zip into your Mattermost web client static path (same origin as the API). Details: [docs/DEV.md](docs/DEV.md) § Kubernetes.

## Branch layout

| Remote / branch | Role |
| --- | --- |
| `origin` | Your GitHub fork of this project |
| `upstream` | `mattermost/mattermost-webapp` (archived reference) |
| `release-7.8-fork` | Integration / release branch |
