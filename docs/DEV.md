# Local / deploy setup (no private hostnames in git)

This fork builds a Mattermost **7.8** webapp with Activity. The browser talks to Mattermost via **same-origin relative `/api`** in production. A remote URL is needed only for **local webpack proxy** (or any special remote-dev setup).

## 1. Local development against a remote Mattermost

1. Copy env file:

```bash
cp local.env.example local.env
```

2. Edit `local.env` — set your server:

```bash
MM_SERVICESETTINGS_SITEURL=https://YOUR_MATTERMOST_HOST
```

(`local.env` is gitignored. A filled copy can live only on your machine.)

3. Install & run:

```bash
npm ci
npm run dev-server:remote
# open http://localhost:9005
```

Webpack proxies `/api` (and related paths) to `MM_SERVICESETTINGS_SITEURL` and rewrites cookies for `localhost`.

Equivalent one-liner without `local.env`:

```bash
MM_SERVICESETTINGS_SITEURL=https://YOUR_MATTERMOST_HOST npm run dev-server
```

Against a local server:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:8065 npm run dev-server
```

## 2. Production / Kubernetes

You usually **do not** bake a Mattermost hostname into the JS bundle.

| Piece | What to set |
| --- | --- |
| Built assets | `npm run build` → `dist/` (zip from `release-fork` workflow) |
| Serving | Serve `dist/` as the Mattermost web client (same host/path your users open) |
| API | Relative `/api/v4/...` → same host as the page |
| Mattermost `SiteURL` | Server config / Helm value for the **public** URL users use (e.g. ingress host) |

### What to substitute in k8s / Helm (checklist)

Fill with your values (see your private `local.env` for the host you use in dev):

```text
# Ingress / Service URL users open in the browser
PUBLIC_WEB_URL=https://YOUR_MATTERMOST_HOST

# Mattermost server SiteURL (must match what browsers use)
MM_SERVICESETTINGS_SITEURL=<same as PUBLIC_WEB_URL>

# Where static webapp files are mounted/copied
WEBAPP_STATIC_PATH=<path or image layer that serves client assets from dist/>
```

Notes:

- If the SPA is served from `PUBLIC_WEB_URL` and API is on the same host, **no** `MM_SERVICESETTINGS_SITEURL` is required inside the webapp container for runtime API calls.
- Use `MM_SERVICESETTINGS_SITEURL` in k8s only if you run this repo’s **webpack-dev-server proxy** pattern in-cluster (unusual). Prefer shipping `dist/` behind the real Mattermost/ingress.
- Cookie/`Secure` issues appear only when the page origin ≠ API origin (local proxy). Production same-origin avoids that.

## 3. Releases

See root `README.md` → GitHub Actions (`release-fork`). Tags stay versioned on `package.json` `7.8.0` (e.g. `7.8.0-fork-releaseN`).
