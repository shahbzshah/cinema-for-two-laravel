# Deploy — Northflank Sandbox (free, no card)

Target: **Northflank Sandbox** — free, no card required, always-on (no sleeping).
One web service + a free Neon Postgres database fits inside the $20/month
Sandbox credit. Live video/voice signalling stays on free PeerJS Cloud, so
there is no second service to pay for.

## What you tap to go live (in order)

1. **Push this code to GitHub** (your call — no repo exists yet).
   Create a repo, then from this folder:
   `git remote add origin https://github.com/shahbzshah/cinema-for-two-laravel.git`
   `git push -u origin main`
2. **Neon (free database, no card)** — sign up at https://neon.tech, create a
   project, copy the Postgres connection string (use the pooled one, it ends
   in `?sslmode=require`).
3. **Northflank (free account, no card)** — sign up at https://northflank.com,
   create a project, then **Add service → From a Git repository** → connect
   your GitHub → pick this repo → build type **Dockerfile** → port **80**.
4. **Environment variables on the Northflank service** (dashboard → service →
   Environment). Generate the key locally first — never reuse the one in your
   local `.env`:

   ```sh
   php artisan key:generate --show
   ```

   | Variable | Value |
   |---|---|
   | `APP_KEY` | the `base64:...` value from the command above |
   | `APP_ENV` | `production` |
   | `APP_DEBUG` | `false` |
   | `APP_URL` | `https://<your-northflank-domain>` |
   | `DB_CONNECTION` | `pgsql` |
   | `DATABASE_URL` | the Neon connection string from step 2 |
   | `SESSION_DRIVER` | `database` |
   | `CACHE_STORE` | `database` |
   | `QUEUE_CONNECTION` | `database` |

5. **Deploy.** The container runs `php artisan migrate --force` on boot, then
   serves the app on port 80. First load can be slow (Neon wakes from zero in
   a few seconds) — that is normal.
6. Open the Northflank URL, create an account, create a room, share the code.

## Cost maths (so nothing surprises you)

- 1 web service on the smallest compute (`nf-compute-50`, $12/mo) + Neon free
  database ($0) = **$12/mo of the $20 Sandbox credit. Fits.**
- A second always-on service (for example Laravel Reverb later) would be
  another ~$12 and push the total over the credit — that is why signalling
  stays on PeerJS Cloud for now.

## Security notes

- Northflank disclosed a secrets incident on 30 Oct 2026 (environment
  variables may have been exposed). Use a **fresh** `APP_KEY` for Northflank,
  never the one from your local `.env`, and rotate it if anything ever leaks.
- Never commit `.env` — it is gitignored and excluded from the Docker image.
- The app sets `APP_DEBUG=false` in production so errors never leak details.

## If the deploy fails

- **Migrations never succeed / container restarts in a loop** — check the
  `DATABASE_URL`: wrong password, wrong host, or missing `?sslmode=require`.
  Neon also suspends compute after 5 idle minutes; the entrypoint retries
  migrations 10 times before giving up.
- **500 on every page** — check `APP_KEY` is set (sessions/encryption need it)
  and `APP_DEBUG=false` is really false.
- **Room page loads but "Sync Offline"** — the PeerJS CDN script or the free
  PeerJS Cloud server is unreachable from that network. Links still save to
  the room; the page polls for new links every 15 seconds.
