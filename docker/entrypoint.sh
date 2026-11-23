#!/bin/sh
set -e

# Wait briefly for the database to accept connections (Neon wakes from
# zero in a few seconds on first query; retry instead of crashing).
# If migrations still fail after 10 tries, exit loudly — starting the
# app with no tables would only serve 500s.
for i in $(seq 1 10); do
  if php artisan migrate --force --no-interaction 2>/dev/null; then
    exec apache2-foreground
  fi
  echo "migrate attempt $i failed, retrying in 5s..."
  sleep 5
done

echo "migrations never succeeded — refusing to start without tables." >&2
exit 1
