#!/usr/bin/env bash
# First-run setup: creates .env with generated secrets, starts the stack,
# mints the Miniflux API token and restarts with it. Safe to run again: it
# never overwrites a value that is already set.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required to generate secrets" >&2; exit 1; }

[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Created .env from .env.example"; }

get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
put() {
  local key="$1" value="$2"
  if grep -qE "^$key=" .env; then
    local tmp; tmp=$(mktemp)
    awk -v k="$key" -v v="$value" -F= 'BEGIN{OFS="="} $1==k{print k, v; next} {print}' .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
fill() { [ -n "$(get "$1")" ] || put "$1" "$2"; }
secret() { openssl rand -base64 32 | tr -d '/+=\n' | cut -c1-"${1:-40}"; }

fill POSTGRES_PASSWORD "$(secret)"
fill MINIFLUX_ADMIN_USERNAME admin
fill MINIFLUX_ADMIN_PASSWORD "$(secret 24)"
fill ABOVEFOLD_SESSION_SECRET "$(secret 48)"
fill ABOVEFOLD_INBOUND_SECRET "$(secret 40)"
NEW_PASSWORD=""
if [ -z "$(get ABOVEFOLD_PASSWORD)" ]; then NEW_PASSWORD="$(secret 20)"; put ABOVEFOLD_PASSWORD "$NEW_PASSWORD"; fi

if [ -z "$(get OPENROUTER_API_KEY)" ]; then
  read -r -s -p "OpenRouter API key (https://openrouter.ai/keys): " KEY; echo
  [ -n "$KEY" ] || { echo "An OpenRouter key is required for summaries and ranking." >&2; exit 1; }
  put OPENROUTER_API_KEY "$KEY"
fi
if [ "$(get ABOVEFOLD_PUBLIC_URL)" = "https://news.example.com" ] || [ -z "$(get ABOVEFOLD_PUBLIC_URL)" ]; then
  read -r -p "Public URL of this instance (e.g. https://news.example.com): " URL
  [ -n "$URL" ] && put ABOVEFOLD_PUBLIC_URL "${URL%/}"
fi

PORT="$(get ABOVEFOLD_PORT)"; PORT="${PORT:-8090}"

echo "Starting the database, Miniflux and the web app..."
docker compose up -d --build db miniflux web
for _ in $(seq 1 90); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/login" && break
  sleep 2
done
curl -fs -o /dev/null "http://127.0.0.1:$PORT/login" || { echo "The web app did not come up; see: docker compose logs web" >&2; exit 1; }

if [ -z "$(get MINIFLUX_API_TOKEN)" ]; then
  echo "Minting the Miniflux API token..."
  TOKEN=""
  for _ in $(seq 1 30); do
    RESPONSE=$(curl -s -u "$(get MINIFLUX_ADMIN_USERNAME):$(get MINIFLUX_ADMIN_PASSWORD)" \
      -X POST "http://127.0.0.1:$PORT/v1/api-keys" -H 'Content-Type: application/json' \
      -d '{"description":"abovefold"}' || true)
    TOKEN=$(printf '%s' "$RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    [ -n "$TOKEN" ] && break
    sleep 2
  done
  [ -n "$TOKEN" ] || { echo "Could not mint the Miniflux token. Response: $RESPONSE" >&2; exit 1; }
  put MINIFLUX_API_TOKEN "$TOKEN"
fi

echo "Starting everything with the token..."
docker compose up -d --build

echo
echo "Abovefold is running on http://127.0.0.1:$PORT"
echo "Point your tunnel or reverse proxy at it; see docs/deploying.md."
if [ -n "$NEW_PASSWORD" ]; then
  echo "Your login password (also in .env as ABOVEFOLD_PASSWORD): $NEW_PASSWORD"
fi
