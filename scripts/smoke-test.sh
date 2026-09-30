#!/usr/bin/env bash
# End-to-end proof that real articles get real summaries and real embeddings.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
q() { docker compose exec -T db psql -U abovefold -d abovefold -tAc "$1" | tr -d '[:space:]'; }

echo "== running the worker once =="
docker compose run --rm worker python -m abovefold_worker --once

echo "== asserting =="
ARTICLES=$(q "select count(*) from app.article")
[ "$ARTICLES" -gt 0 ] || fail "no rows in app.article"
echo "  articles:            $ARTICLES"

EXTRACTED=$(q "select count(*) from app.article where extracted_text is not null and extract_status in ('ok','fallback')")
[ "$EXTRACTED" -gt 0 ] || fail "no article has extracted text"
echo "  with extracted text: $EXTRACTED"

EMBEDDED=$(q "select count(*) from app.article_ai where embedding is not null")
[ "$EMBEDDED" -gt 0 ] || fail "no embeddings stored"
echo "  with embeddings:     $EMBEDDED"

DIMS=$(q "select vector_dims(embedding) from app.article_ai where embedding is not null limit 1")
[ "$DIMS" = "1536" ] || fail "embedding dimension is $DIMS, expected 1536"
echo "  embedding dims:      $DIMS"

SUMMARISED=$(q "select count(*) from app.article_ai where summary is not null and length(summary) > 20")
[ "$SUMMARISED" -gt 0 ] || fail "no summaries stored"
echo "  with summaries:      $SUMMARISED"

SCORED=$(q "select count(*) from app.score")
[ "$SCORED" -gt 0 ] || fail "nothing scored"
echo "  scored:              $SCORED"

REASONS=$(q "select count(*) from app.score where reason is not null and reason <> ''")
[ "$REASONS" -gt 0 ] || fail "scores carry no reason text"
echo "  with reasons:        $REASONS"

COST=$(q "select coalesce(sum(cost_usd),0) from app.article_ai")
echo "  month-to-date cost:  \$$COST"

echo
echo "== a real ranked row =="
docker compose exec -T db psql -U abovefold -d abovefold -c "
select round(s.final_score::numeric,3) as score, left(a.title,52) as title, s.reason
from app.score s join app.article a on a.id = s.article_id
order by s.final_score desc limit 5;"

echo "SMOKE PASS"
