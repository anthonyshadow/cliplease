#!/usr/bin/env bash
# The local test database (owner answers Q-87, Q-89): Postgres 18, the major Neon runs, in Docker Desktop, the way CI's
# postgres service will run it (P32), instead of the Neon test branch over the network. `bun run test:db` starts Docker
# Desktop if Docker isn't up, creates or starts the container, waits for it and applies the migrations. The tests reach
# it through .env.test.local (git-ignored), whose two database URLs are $URL below (the script prints the lines when
# they're missing); delete that file to go back to the Neon test branch. The container listens on 127.0.0.1 only, holds
# nothing but test rows (every run empties it) and skips fsync for speed: after a crash, `docker rm -f cliplease-test-db
# && docker volume rm cliplease-test-db`, then run this again.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=cliplease-test-db
IMAGE=postgres:18
PORT=54329
URL="postgres://cliplease:cliplease@127.0.0.1:$PORT/cliplease_test"

if ! docker info >/dev/null 2>&1; then
  if [ ! -d /Applications/Docker.app ]; then
    echo "test:db: Docker isn't running and Docker Desktop isn't installed." >&2
    exit 1
  fi
  echo "test:db: starting Docker Desktop…"
  open -a Docker
  for _ in $(seq 1 120); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null
fi

if ! docker container inspect "$NAME" >/dev/null 2>&1; then
  echo "test:db: creating $NAME ($IMAGE on 127.0.0.1:$PORT)…"
  docker run -d --name "$NAME" --restart unless-stopped \
    -p "127.0.0.1:$PORT:5432" \
    -e POSTGRES_USER=cliplease -e POSTGRES_PASSWORD=cliplease -e POSTGRES_DB=cliplease_test \
    -v "$NAME:/var/lib/postgresql" \
    "$IMAGE" -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null
else
  docker start "$NAME" >/dev/null
fi

# Over TCP: the first start's init runs a temporary server on the Unix socket only, then restarts.
ready() { docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U cliplease -d cliplease_test; }
for _ in $(seq 1 120); do
  ready && break
  sleep 0.5
done
ready || {
  echo "test:db: $NAME isn't accepting connections after a minute: see \`docker logs $NAME\` (after a crash, remove it and its volume as above)." >&2
  exit 1
}

if ! grep -qs "^DATABASE_URL=$URL$" .env.test.local || ! grep -qs "^DATABASE_URL_UNPOOLED=$URL$" .env.test.local; then
  echo "test:db: the database is up, but the tests use it only once .env.test.local holds:" >&2
  echo "  DATABASE_URL=$URL" >&2
  echo "  DATABASE_URL_UNPOOLED=$URL" >&2
  exit 1
fi

NODE_ENV=test bun run db:migrate
echo "test:db: ready ($NAME, migrated)."
