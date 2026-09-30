#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo -n "app tables: "
docker compose exec -T db psql -U abovefold -d abovefold -tAc \
  "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='app';"
echo -n "extension: "
docker compose exec -T db psql -U abovefold -d abovefold -tAc \
  "select extname from pg_extension where extname='vector';"
echo -n "embedding dims: "
docker compose exec -T db psql -U abovefold -d abovefold -tAc \
  "select atttypmod from pg_attribute where attrelid='app.article_ai'::regclass and attname='embedding';"
