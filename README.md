# Cinema for Two — Laravel rebuild (v1)

A private watch-together app for two people, rebuilt in Laravel. One account,
rooms with 6-character codes, and a shared mini-browser: paste a link and both
phones open the same page.

**v1 scope (this build):** email/password auth + rooms + shared mini-browser,
working end-to-end. Live video/voice calling comes in v2 (PeerJS shell is
already on the room page for link sync; the camera call is not wired yet).
Full video-player sync comes after that.

## How it works

- **Auth** — hand-rolled Laravel session auth (no Breeze, no npm). Register,
  log in, log out. The same DESIGN.md idiom as the static app (canvas
  `#0C0C0E`, card `#141417`, amber `#E5A93C`, Newsreader / Plus Jakarta Sans /
  JetBrains Mono — fonts self-hosted under `public/fonts/`).
- **Rooms** — `rooms` table: 6-char code (unique, the invite), owner. Any
  signed-in user who knows the code can open the room.
- **Shared mini-browser** — `weblinks` table: `room_id`, `url`, `shared_by`.
  Paste a URL on the room page (validated and normalised server-side —
  `https://` added when missing, only http/https allowed). Both phones open
  the same URL in an in-app iframe with an address bar, a **Sync page**
  button, and an **Open in browser** fallback. A shared-links shelf lists
  every link shared to the room.
  - Each phone scrolls and taps on its own screen. Cross-origin scroll/click
    sync is not attempted — the browser forbids a page from reading scroll
    position or clicks inside another site.
  - Sites that refuse embedding (X-Frame-Options / CSP) show a plain
    "does not allow embedding" notice after a 10-second load timeout.
  - Live link sharing runs over free PeerJS Cloud (room code = peer id,
    same as the static app), with a 15-second server poll as the fallback.
- **Database** — SQLite locally; Postgres via `DATABASE_URL` (Neon, free, no
  card) on deploy. Sessions/cache/queue all use the database driver, never
  the filesystem (free hosts have ephemeral disks).

## Run it locally

```sh
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve
```

Open http://127.0.0.1:8000, create an account, create a room.

## Tests

```sh
php artisan test
```

32 tests (auth, rooms, weblinks, URL normalisation). All must pass.

## Deploy

Free, no card: **Northflank Sandbox** + **Neon Postgres**. Full steps in
[docs/DEPLOY.md](docs/DEPLOY.md) — including exactly what to tap and the
environment variables to set. Not deployed, not pushed to GitHub yet: that
needs the user's call.

## What is NOT in v1

- Video/voice calling (PeerJS shell present, call not wired).
- Synced video player (YouTube / local file) — that lives in the static app
  today and ports over after v1.
- Password reset / email verification (no mail service on the free tier).
