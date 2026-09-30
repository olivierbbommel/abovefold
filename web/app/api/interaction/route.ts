import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

// This table is the Phase 3 training signal (see plan Task 5). It must never
// accept anything outside this exact list, a stray typo here would quietly
// poison the ranking model's inputs.
const VALID_ACTIONS = ["opened", "skipped", "read_later", "archived", "hidden_source"] as const;
type InteractionAction = (typeof VALID_ACTIONS)[number];

function isValidAction(value: unknown): value is InteractionAction {
  return typeof value === "string" && (VALID_ACTIONS as readonly string[]).includes(value);
}

/**
 * Writes one row to app.interaction. Body: { articleId: number, action: string,
 * dwellMs?: number }. Deliberately permissive about how the body arrives , 
 * DwellTracker's unload beacon is sent via navigator.sendBeacon, which can't
 * set a Content-Type header reliably across browsers, so we parse the raw
 * text as JSON rather than relying on request.json()'s content-type checks.
 */
export async function POST(request: NextRequest) {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "could not read request body" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { articleId, action, dwellMs, interactionId } = body as Record<string, unknown>;

  // Dwell arrives AFTER the row exists: DwellTracker posts `opened` on mount,
  // then reports how long the reader stayed when they leave. Updating the
  // original row keeps one row per read, it previously inserted a SECOND
  // `opened` row, which inflated the count and diluted the share of reads
  // carrying a dwell time, the exact signal the ranker gates on.
  if (typeof interactionId === "number" && Number.isInteger(interactionId) && interactionId > 0) {
    const ms = typeof dwellMs === "number" && Number.isFinite(dwellMs) && dwellMs >= 0
      ? Math.min(Math.round(dwellMs), 6 * 60 * 60 * 1000)   // cap a tab left open overnight
      : null;
    if (ms === null) {
      return NextResponse.json({ error: "dwellMs must be a non-negative number" }, { status: 400 });
    }
    // The id comes from the client, so it is not trusted on its own: scope the
    // update to the article being reported AND to a row created recently.
    // Without this, a crafted request could write an arbitrary dwell time onto
    // any row, and dwell is exactly what Phase 3 relevance is built from.
    if (!Number.isInteger(articleId) || (articleId as number) <= 0) {
      return NextResponse.json({ error: "articleId is required with interactionId" }, { status: 400 });
    }
    const { rowCount } = await pool.query(
      `update app.interaction
          set dwell_ms = greatest(coalesce(dwell_ms, 0), $1)
        where id = $2
          and article_id = $3
          and action = 'opened'
          and created_at > now() - interval '12 hours'`,
      [ms, interactionId, articleId],
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: "no matching interaction" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: interactionId });
  }

  const articleIdNum = Number(articleId);
  if (!Number.isInteger(articleIdNum) || articleIdNum <= 0) {
    return NextResponse.json({ error: "articleId must be a positive integer" }, { status: 400 });
  }

  if (!isValidAction(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  let dwellMsNum: number | null = null;
  if (dwellMs !== undefined && dwellMs !== null) {
    dwellMsNum = Number(dwellMs);
    if (!Number.isFinite(dwellMsNum) || dwellMsNum < 0) {
      return NextResponse.json({ error: "dwellMs must be a non-negative number" }, { status: 400 });
    }
    dwellMsNum = Math.round(dwellMsNum);
  }

  const { rows } = await pool.query<{ id: string }>(
    `insert into app.interaction (article_id, action, dwell_ms) values ($1, $2, $3) returning id`,
    [articleIdNum, action, dwellMsNum]
  );

  return NextResponse.json({ ok: true, id: Number(rows[0].id) }, { status: 201 });
}
