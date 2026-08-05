# Spoon tracker

A personal, map-based tracker for a souvenir spoon collection — log a spoon from any
device, check from any other whether you already have one from a place, and browse the
whole collection on a map (offline too). Full design in [CLAUDE.md](CLAUDE.md).

- **Front-end:** static [Eleventy](https://www.11ty.dev/) site, Leaflet map (bundled, no
  CDN), installable offline PWA. Deploys to GitHub Pages.
- **Storage:** a Cloudflare Worker (`worker/`) in front of Workers KV — one KV key per
  spoon, so concurrent writes from different devices never clobber each other. Reads are
  open; writes require a token.
- **No secrets in this repo.** The write token is a Cloudflare Worker secret; on your
  devices it lives in Apple Passwords / iCloud Keychain, never in the code.

## Local development

```bash
npm install
npm start            # front-end at http://localhost:8080/  (add ?demo=1 for sample data)
npm run worker:dev   # run the Worker locally
```

## Deploy

- **Worker:** `npm run worker:deploy` (config in `wrangler.toml`; the write token is set
  once with `npx wrangler secret put WRITE_TOKEN` and is never committed).
- **Front-end:** pushing to `main` triggers `.github/workflows/deploy.yml` → GitHub Pages.
  Set **Settings → Pages → Source → GitHub Actions**. Served at
  `https://<user>.github.io/spoon-tracker/`.

## Using it

Open the site, tap **🔒 Unlock writing**, paste your write token (Safari offers to save it
to Apple Passwords and syncs it to your other devices), then **+ Add spoon** → search a
place (OpenStreetMap Nominatim) → save. Add / edit / delete all require the token; reading
and browsing do not. Offline, it shows your last-synced spoons on the bundled basemap.

## Backup

The KV store is the live source of truth; git is the safety net:

```bash
npm run backup       # writes data/spoons.json from the live Worker — review and commit
```

The spoon data isn't sensitive, so committing it to this repo is fine and gives a
versioned history of the collection.
