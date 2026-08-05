# Spoon tracker

A personal tracker for a collection of souvenir spoons, each tied to a place. The point:
log a spoon from anywhere, check from anywhere else whether I already have one from a
given country or city, and browse the collection on a map — including offline for
viewing and search.

**This repo will be public / open source. No credentials, tokens, or secrets ever go in
it.** See "Security" — the design is built so that none need to.

## What this is (and isn't)

- A static front-end (installable as an app; offline for viewing/search, writes need a
  connection) plus a tiny Cloudflare Worker in front of a Cloudflare Workers KV store
  that holds the collection.
- Single user (me), multi-device (phone + laptop see the same list). Not multi-user, no
  accounts, no sharing/permissions beyond "the owner can write, everyone can read".
- Nothing sensitive is stored. Reads are open; the protection that matters is that
  **only I can write.**

## Decisions already made. Do not revisit these.

- **Front-end reuses the `roadtrip26` skeleton:** Eleventy v3 static build, Leaflet 1.9.4
  bundled locally (no CDN), a bundled public-domain Natural Earth basemap. Installable as
  an app (web manifest + icons + standalone display, so iOS Add-to-Home-Screen launches it
  full-screen), with a service worker that precaches the shell and a locally-cached copy
  of the list for **offline viewing and search** — adding still needs a connection. Same
  palette/field-tool sensibility.
- **Storage is Cloudflare Workers KV, reached only through a Cloudflare Worker** (decided
  2026-08-05). The KV namespace is never hit directly from the browser. Chosen for least
  ongoing hassle: managed, always-on, works from anywhere without a VPN. Data exposure is
  not a concern (nothing sensitive; reads are open) — the only cost is a write token, made
  near-invisible via Apple Passwords autofill (see Security).
  - *Considered and deferred:* a **VPN-gated self-hosted DB** (e.g. a small Postgres table
    on the k8s cluster behind Tailscale — no public exposure, full ownership, but a box
    that must stay up + the VPN on every device + TLS plumbing = more to operate). Remains
    the documented fallback if the trade ever changes.
  - *Considered and rejected:* backing the store with a **PKM** — no single PKM both
    covers a broad personal archive and serves as a clean write target for this app. If a
    markdown PKM (Obsidian/Trilium) is adopted later, convert the JSON backup to
    `spoons/*.md` with frontmatter then; do not build for it speculatively now.
- **KV holds one key per spoon** (`spoon:<id>`), so concurrent writes from different
  devices can't clobber each other — each add is an independent write, not a
  read-modify-write of a shared document. `GET /spoons` lists + gets all keys and returns
  the array. (KV is eventually consistent, so a write can take up to ~a minute to show up
  on another device; a refresh fixes it — fine for a spoon list.)
- **Writes are add, edit, and delete.** Normally a spoon is added; you can also correct a
  record and delete one (a mistake, or a spoon you no longer have). Delete is a hard
  delete of that record. (If you later want to keep a history of spoons once owned but
  since gone, switch delete to a soft `status: "gone"` flag instead — not done now.)
- **Offline is view-only.** Viewing and searching the collection work offline from the
  last-synced cache; adding/editing/deleting need a connection (nobody adds a spoon
  offline). Place search uses OpenStreetMap Nominatim (online, keyless).
- **No secrets in the repo, ever.** Not in code, not in `wrangler.toml` beyond
  non-secret IDs, not in the built site.

## Architecture

```
Browser (installable app)                Cloudflare
┌─────────────────────────┐              ┌───────────────────────────┐
│ Eleventy site + Leaflet │  fetch       │ Worker (public URL)       │
│ - caches list; offline  │ ───GET────▶  │  GET /spoons  → list KV   │
│   view/search only      │ ──POST/PUT/  │  writes: check WRITE_TOKEN│
│ - write token: Keychain │   DELETE──▶  │          → per-key KV     │
└─────────────────────────┘   +token     └──────────┬────────────────┘
                                                     │ binding (no secret)
                                                     ▼
                                          Workers KV  keys "spoon:<id>"
```

- **GET is open** (nothing sensitive). The client fetches the whole list each load and
  caches it locally so viewing/search work offline.
- **Writes (POST add / PUT edit / DELETE)** require an `Authorization: Bearer
  <WRITE_TOKEN>` header. The Worker validates it, then does the KV update. The Worker
  assigns `id` and timestamps server-side (don't trust the client for those).
- **The front-end is deployed like `roadtrip26`** (GitHub Pages and/or a GHCR nginx
  image). The Worker is deployed separately with `wrangler`.

## Security & credentials

The one rule: **the repo is public, so nothing secret lives in it.**

- **Worker ↔ KV:** a binding in `wrangler.toml` (`[[kv_namespaces]]`). No password in code.
  The namespace *id* is not a secret and may be committed; access to it requires the
  account token, which is not here.
- **Write token (`WRITE_TOKEN`):** a long random string set as a Worker secret via
  `wrangler secret put WRITE_TOKEN`. Encrypted at Cloudflare, never in the repo or the
  built JS. The Worker rejects any write without it. Rotate any time with another
  `wrangler secret put`; nothing is lost.
- **My devices:** the write token is kept in **Apple Passwords / iCloud Keychain**, not
  in the site. The app shows a small sign-in form (a username field plus
  `<input type="password" autocomplete="current-password">`); Safari offers to save the
  token to the Keychain and syncs it across my Apple devices, autofilling it thereafter.
  The app keeps it in **session storage** (cleared when the tab/app closes), never in
  `localStorage`; Apple Passwords is the durable, synced copy. Only devices with the token
  can write; the public site ships without it.
  - *Future upgrade:* replace the shared token with a **passkey/WebAuthn** — the
    credential lives in iCloud Keychain, nothing is ever pasted, and writes are authorised
    by a Face/Touch ID signature that the Worker verifies before issuing a short-lived
    write session. More Worker work; no shared secret to leak or rotate.
- **Cloudflare account token:** used only by `wrangler` on my machine to deploy. Lives in
  my shell/`wrangler login`, never in the repo.
- **Net effect:** a stranger who clones the repo or opens the site can *read* the spoon
  list and has no way to write, and finds no secrets to steal.

## Data model

One record per spoon. Each is its own KV key (`spoon:<id>`); `GET /spoons` returns them
as a JSON array:

```jsonc
{
  "id": "…",            // assigned by the Worker (time-ordered + random)
  "name": "…",          // label, e.g. "Kraków" or "Wieliczka salt mine"
  "country": "PL",      // ISO 3166-1 alpha-2 where possible (drives per-country views)
  "countryName": "Poland",
  "city": "Kraków",     // optional
  "lat": 50.0614, "lng": 19.9372,
  "note": "…",          // optional
  "addedAt": "2026-08-05T12:00:00Z",   // Worker-set
  "editedAt": "…"       // Worker-set on correction
}
```

- `country` is the key field: the per-country views and offline "do I have one from X?"
  depend on it being consistent. When geocoding fills it in, store the ISO code.
- Correcting a record updates it in place and sets `editedAt`. Deleting removes the
  record (a mistake, or a spoon you no longer have).

## Front-end behaviour

**Adding a spoon (online):** search a place by name → results from OSM **Nominatim** (or
Photon), keyless and free, rate-limited so debounce and attribute → pick one → the result
gives lat/lng, city and country (ISO) → confirm the chosen place → save (POST with token).

**Offline:** the last successfully-fetched list is cached locally. With no connection I
can still: search/filter my collection by country and city, see the counts, the dots, and
the per-country views, all on the bundled offline basemap. Writing is disabled offline
(show it clearly rather than queueing — offline logging is explicitly not needed).

**Views required:**
1. **Total count** — how many spoons in all.
2. **Dots map** — one marker per spoon at its lat/lng.
3. **Per-country overview** — a "By country" toggle: one numeric count marker per country
   (placed at the mean position of that country's spoons) plus a chip list of the counts.
4. **Per-country drill-down** — click a country (chip or count marker) → filter to it,
   switch to dots, and fit the map to that country's spoons.
5. **Search** by country/city that also answers "do I already have one from here?".

Keep the same restraint as `roadtrip26`: high contrast, big tap targets, no console
errors, works from 360 px up, `prefers-reduced-motion` respected.

## Running it

```bash
npm install
npm start            # front-end at http://localhost:8080/  (append ?demo=1 for sample data)
npm run worker:dev   # run the Worker locally
npm run worker:deploy
npm run backup       # snapshot the live collection to data/spoons.json (then commit)
```

## Backup to git ("you never know if a service goes down")

The KV store is the live source of truth; git is the durable backup.

- `npm run backup` (run from the laptop): `GET /spoons`, write the array to
  `data/spoons.json` in this repo, and stop — I review and commit. The spoon data is not
  sensitive, so committing it to the public repo is fine and gives a versioned history of
  the collection.
- Restore (not built yet): if the service is ever lost, re-seed KV from `data/spoons.json`
  — would need a token-gated bulk-import endpoint on the Worker. Add if/when needed.
- Optionally schedule the backup, but the manual "fetch → commit" flow is the baseline.

## Deployment

- **Worker:** `wrangler deploy` (config in `wrangler.toml`; `WRITE_TOKEN` via
  `wrangler secret put`). One KV namespace.
- **Front-end:** GitHub Pages via Actions (`.github/workflows/deploy.yml`; Settings →
  Pages → Source → GitHub Actions). The Worker URL is baked in from `_data/config.js`
  (override with the `SPOON_API` env at build) — non-secret, safe to commit. A GHCR nginx
  image like roadtrip26's could be added later but isn't set up.
- **Paths:** the front-end uses relative asset/link paths (not an Eleventy `pathPrefix`),
  so it works unchanged at the Pages subpath `/<repo>/` and at a domain root.

## Out of scope

No user accounts or multi-user permissions, no photos/attachments (revisit later with a
plan if wanted), no offline *writing*, no soft-delete / de-accession history (delete is a
hard delete), no self-hosted database, no analytics. If any seems necessary, say so
rather than building it.

## Status (built & deployed, 2026-08-05)

Live and verified:
- **Worker:** `https://spoon-tracker.mufflon.workers.dev` — one key per spoon; open `GET`,
  token-gated `POST` / `PUT /:id` / `DELETE /:id`. Tokenless writes are rejected (401).
- **Front-end:** `https://mufflon.github.io/spoon-tracker/` — Nominatim add flow, the map
  views + search, offline view/search (service worker + cached list), installable PWA.
  CORS from the Pages origin works, no console errors.
- **Backup:** `npm run backup` → `data/spoons.json`.

Remaining / optional (not built):
- `npm run restore` + a token-gated bulk-import endpoint on the Worker (for full recovery).
- A GHCR container image, as roadtrip26 has.
- Possible refinement: a true country-outline drill-down view (currently drill = filter +
  fit to that country's spoons).
