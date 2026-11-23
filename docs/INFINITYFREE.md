# Deploy — InfinityFree (free shared PHP hosting, no card)

**Why this host:** Northflank's free tier demands a card to create a
service (verified live 23 Nov 2026 — the earlier "no card" research was
wrong). InfinityFree is free with no card and stays awake. The trade-off
is plain shared PHP hosting: no shell, no composer, no Postgres, no
background workers, 50,000 hits/day.

**Status:** the deployment package is ready —
`cinema-for-two-infinityfree.zip` (9,065,775 bytes, 7,560 files) in this
repo folder. It carries a complete `vendor/` (installed with
`composer install --no-dev --optimize-autoloader`) because the server
has no composer. Nothing in the app needed changing for MySQL (see
"MySQL, not Postgres" below).

## Steps (in order)

### 1. InfinityFree account (free, no card)
Sign up at https://infinityfree.com (a browser task for this is already
open). In the client area, **Create Account** on the free plan and pick a
free subdomain, for example `cinema-for-two.infinityfreeapp.com`. Note
the exact subdomain — that becomes `APP_URL`.

### 2. MySQL database
Control panel → **MySQL Databases** → create a database. Note the exact
values from the panel (names carry your account prefix, e.g.
`if0_12345678_cinema` — copy them exactly):
- MySQL host — looks like `sqlXXX.infinityfree.com`
- Database name, username, password

### 3. Upload the app
File manager → `htdocs/` → delete the default files (`index2.html`
etc.). Upload `cinema-for-two-infinityfree.zip` into `htdocs/` and
extract it there, so `htdocs/` contains `artisan`, `app/`, `public/`,
`vendor/`, `.htaccess`, etc. — **not** a subfolder. (If the file-manager
upload fails on size — the zip is ~9 MB — use FTP instead with the same
account credentials; FileZilla works.)

### 4. Create `.env` in the file manager
In `htdocs/`, create a file named `.env` with exactly these values.
Paste the `APP_KEY` below; MySQL values come from step 2. **Do NOT add
a `DB_URL` or `DATABASE_URL` line** — with `DB_URL` set, Laravel ignores
the `DB_HOST` / `DB_DATABASE` lines below and the database will not
connect.

```
APP_NAME="Cinema for Two"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://<your-subdomain-from-step-1>
APP_KEY=base64:9LvvKqPDglTZoLa2w7DFLRjUz/UvwMDCe5JHr0MRFVQ=
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US
APP_MAINTENANCE_DRIVER=file
BCRYPT_ROUNDS=12
LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=error
DB_CONNECTION=mysql
DB_HOST=<mysql host from step 2>
DB_PORT=3306
DB_DATABASE=<database name from step 2>
DB_USERNAME=<username from step 2>
DB_PASSWORD=<password from step 2>
SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null
BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
QUEUE_CONNECTION=database
CACHE_STORE=database
MAIL_MAILER=log
```

### 5. Free SSL certificate (REQUIRED)
Control panel → **Free SSL Certificates** → get a certificate for the
subdomain and install it. Do not skip this: the static app loads over
`https`, and an `http` Laravel site would be blocked as mixed content —
including the proxy iframe, which is the whole point of this deploy.

### 6. Run the migrations once
InfinityFree has no shell, so there is no `artisan` to run. The package
includes a one-time runner, `public/migrate-once.php` (already tested
locally: wrong/missing token → 403, correct token → migrations run).
- Add a `MIGRATE_TOKEN` line to `.env` first: a long random string you
  pick now, e.g. 32 random characters. It only needs to live until the
  migrations run.
- Visit `https://<subdomain>/migrate-once.php?token=<MIGRATE_TOKEN>`
  in a browser. It should print the migration list and
  `Migrations OK — now DELETE this file.`
- **Delete `public/migrate-once.php` from the file manager immediately
  after it reports success**, and remove the `MIGRATE_TOKEN` line from
  `.env`. It must never stay on a live server.

### 7. Verify
- Open `https://<subdomain>/` — the login page should load. Register an
  account, create a room, share a link.
- While logged in, test the proxy:
  `https://<subdomain>/proxy?url=https://example.org` — it should return
  the example.org page. If it returns 502, outbound fetching may be
  restricted on that account: the room still works (links save; the 15s
  poll is the fallback), but synced browsing will not.

### 8. Follow-up in the static app (separate step)
The synced-browsing toggle shipped in the static app (?v=57) is dormant
until the Laravel URL is set: `PROXY_BASE_URL` in the static app's
`app.js` must be set to `https://<subdomain>` and shipped as the next
`?v=` build. Until then the mini-browser works as before (?v=56), and
the Laravel app works on its own (rooms + shared links + proxy).

## MySQL, not Postgres
- `config/database.php` already has a stock `mysql` connection using the
  standard `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` /
  `DB_PASSWORD` env vars — no code change was needed.
- Checked 23 Nov: no migration and no query in the app is Postgres-
  specific — plain `Schema` builder calls, no raw SQL, no `jsonb`, no
  `DATABASE_URL` anywhere in the app code. The only `pgsql` reference is
  the unused connection definition in `config/database.php`.
- The Neon Postgres project (`cinema-for-two`, Frankfurt) stays as an
  unused backup. Do **not** point this app at it — InfinityFree's PHP
  cannot be confirmed to have `pdo_pgsql`.

## Honest limits
- **No cron / worker / Reverb.** Fine for v1: nothing is queued
  (`QUEUE_CONNECTION=database` but no jobs are dispatched). Sessions and
  cache use the database tables, which the migrations create.
- **50,000 hits/day** on the free plan. Two people watching should stay
  well under it, but a hit-limit suspension would take the app down
  until the next day.
- **PHP 8.4** on InfinityFree; Laravel 13 needs `^8.3` — OK.
- **No shell, no composer** — that is why the zip carries a complete
  `vendor/`. Never upload the repo's local `.env` (it is gitignored and
  NOT in the zip); the server `.env` is created by hand in step 4.
- **The proxy fetches pages from the server** — outbound HTTPS + DNS
  must work on the account (verify in step 7). If InfinityFree blocks
  it, synced browsing falls back to the direct iframe.
- **Free SSL must be renewed** via the panel before it expires
  (typically 3 months — set a reminder).
- `storage/` and `bootstrap/cache/` must stay writable (they are after
  extraction; if a 500 mentions storage, check folder permissions in
  the file manager).

## If the deploy fails
- **500 on every page** — check `.env` `APP_KEY` is set, and that
  `storage/` and `bootstrap/cache/` are writable. To see the real error
  once, set `APP_DEBUG=true`, reload, then set it back to `false`.
- **"Connection refused" / "Access denied" on login** — the MySQL values
  are copied wrong, or a `DB_URL` line is present in `.env` (delete it —
  it overrides the `DB_*` lines).
- **`migrate-once.php` returns 403** — the `MIGRATE_TOKEN` in `.env`
  does not match the token in the URL, or `.env` was not saved.
- **Login page loads but `/proxy` 502s** — outbound fetching restricted
  on that account (see step 7).
- **SSL warnings / mixed content** — the certificate is not installed,
  or `APP_URL` is still `http://` — fix both.

## Security notes
- Never commit `.env` — it is gitignored and NOT in the zip.
- The `APP_KEY` in step 4 is fresh for InfinityFree only — never reuse
  the Northflank key or the local `.env` key.
- Delete `public/migrate-once.php` right after migrations run.
- The root `.htaccess` in `htdocs/` routes everything into `public/`
  and blocks `.env` from being served, so the app files are not
  web-accessible.
