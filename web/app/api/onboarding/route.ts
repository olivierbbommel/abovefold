import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

/**
 * Onboarding gate state, backed by the app.user_state singleton (see
 * db/init/06-user-state.sql). GET is polled by middleware.ts to decide
 * whether to redirect to /welcome; POST is called once, when the welcome
 * flow finishes or is skipped.
 */
export async function GET() {
  const { rows } = await pool.query<{ onboarded_at: Date | null }>(
    `select onboarded_at from app.user_state where id = 1`
  );
  const onboardedAt = rows[0]?.onboarded_at ?? null;
  return NextResponse.json({ onboarded: onboardedAt !== null });
}

function baseUrl(): string {
  const url = process.env.MINIFLUX_URL;
  if (!url) throw new Error("MINIFLUX_URL environment variable is not set");
  return url;
}

function authHeaders(): Record<string, string> {
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!token) throw new Error("MINIFLUX_API_TOKEN environment variable is not set");
  return { "X-Auth-Token": token };
}

/**
 * Deletes the seed feeds the user chose to remove on the "your starter
 * feeds are already there" step. Best-effort and sequential: one failed
 * delete must not stop onboarding from completing, or block the rest.
 */
async function removeFeeds(feedIds: number[]): Promise<{ removed: number; failed: number[] }> {
  let removed = 0;
  const failed: number[] = [];
  for (const feedId of feedIds) {
    try {
      const res = await fetch(`${baseUrl()}/v1/feeds/${feedId}`, {
        method: "DELETE",
        headers: authHeaders(),
        cache: "no-store",
      });
      if (res.ok) {
        removed++;
      } else {
        failed.push(feedId);
      }
    } catch {
      failed.push(feedId);
    }
  }
  return { removed, failed };
}

/**
 * Marks onboarding complete, called on "Skip" as well as on finishing the
 * flow. Optional body: { removeFeedIds?: number[] }, the seed feeds the
 * user chose to remove in step 2.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const removeFeedIds = (body as { removeFeedIds?: unknown } | null)?.removeFeedIds;

  let removal: { removed: number; failed: number[] } | null = null;
  if (Array.isArray(removeFeedIds) && removeFeedIds.length > 0) {
    const ids = removeFeedIds.filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0
    );
    if (ids.length > 0) removal = await removeFeeds(ids);
  }

  await pool.query(
    `update app.user_state set onboarded_at = now() where id = 1 and onboarded_at is null`
  );
  return NextResponse.json({ onboarded: true, removal });
}
