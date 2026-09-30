"use server";

import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { pool } from "@/lib/db";
import { entryStarred, entryState, markRead, toggleStar } from "@/lib/miniflux";

/**
 * Server actions behind RowActions.tsx (the real Read Later / Archive
 * buttons) and the Undo affordance on their toasts.
 *
 * These write to app.interaction and talk to Miniflux the same way the
 * article page's existing readLaterAction/archiveAction do (see
 * app/article/[id]/page.tsx), direct pool.query + lib/miniflux calls,
 * not an internal HTTP round-trip to POST /api/interaction or POST
 * /api/read. Both of those routes sit behind middleware.ts's session-cookie
 * check, so a self-fetch from a server action would need to forward the
 * request's cookie for no real benefit: we're already running server-side
 * with a live DB connection and the same Miniflux client those routes use
 * (markRead is literally the function /api/read calls), so we call it
 * directly instead of duplicating its HTTP plumbing.
 *
 * `minifluxId` is accepted for callers that already know it, mirroring the
 * article page's existing actions, but Item (lib/types.ts) doesn't carry a
 * miniflux id today, so RowActions (which only has an Item) can't supply
 * one. Every action here re-resolves it from app.article by articleId
 * whenever it's missing, which is also just safer than trusting a
 * client-supplied foreign id.
 */

export type ActionResult = { ok: true; interactionId: number } | { ok: false; error: string };

export type UndoResult = { ok: true } | { ok: false; error: string };

type LoggedAction = "read_later" | "archived";

/*
 * Server actions are public POST endpoints addressed by an action id. The
 * middleware covers them today, but an action that trusts its caller is one
 * matcher edit away from being open, so each one checks the session itself.
 */
async function signedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(COOKIE_NAME)?.value);
}

async function resolveMinifluxId(articleId: number, minifluxId?: number): Promise<number | null> {
  if (typeof minifluxId === "number" && Number.isInteger(minifluxId) && minifluxId > 0) {
    return minifluxId;
  }
  const { rows } = await pool.query<{ miniflux_id: string }>(
    `select miniflux_id from app.article where id = $1`,
    [articleId]
  );
  const row = rows[0];
  if (!row) return null;
  const id = Number(row.miniflux_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function insertInteraction(articleId: number, action: LoggedAction): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into app.interaction (article_id, action) values ($1, $2) returning id`,
    [articleId, action]
  );
  return Number(rows[0].id);
}

function isValidArticleId(articleId: number): boolean {
  return Number.isInteger(articleId) && articleId > 0;
}

/**
 * Bookmark a story. Stars it in Miniflux first, that's the state
 * readLaterItems() actually reads (see lib/queries.ts), so it's the part
 * that has to succeed for "Saved for later" to be true, then logs the
 * training signal. If the interaction insert fails after the star
 * succeeded, it un-stars again rather than leaving a starred article with
 * no record of why.
 */
export async function saveForLater(articleId: number, minifluxId?: number): Promise<ActionResult> {
  if (!(await signedIn())) return { ok: false, error: "not signed in" };
  if (!isValidArticleId(articleId)) return { ok: false, error: "invalid article" };

  const resolvedMinifluxId = await resolveMinifluxId(articleId, minifluxId).catch(() => null);
  if (!resolvedMinifluxId) return { ok: false, error: "article not found" };

  // Miniflux only has a toggle. Look first, so pressing Save twice keeps
  // the article saved instead of quietly removing it.
  let starredNow = false;
  try {
    starredNow = await entryStarred(resolvedMinifluxId);
    if (!starredNow) await toggleStar(resolvedMinifluxId);
  } catch (err) {
    console.error("saveForLater: failed to star in Miniflux", err);
    return { ok: false, error: "could not save" };
  }
  // Already saved: nothing changed, so log nothing and offer no Undo. Its
  // Undo used to toggle the star and un-save the EARLIER save.
  if (starredNow) return { ok: true, interactionId: 0 };

  try {
    const interactionId = await insertInteraction(articleId, "read_later");
    return { ok: true, interactionId };
  } catch (err) {
    console.error("saveForLater: failed to log interaction, reverting star", err);
    if (!starredNow) await toggleStar(resolvedMinifluxId).catch((revertErr) => {
      console.error("saveForLater: revert also failed, article is starred with no interaction row", revertErr);
    });
    return { ok: false, error: "could not save" };
  }
}

/**
 * Archive a story: mark it read in Miniflux (so it stops showing up as
 * unread in Reeder/NetNewsWire, you're done with it) and log the signal.
 * Same ordering/rollback rationale as saveForLater.
 */
export async function archive(articleId: number, minifluxId?: number): Promise<ActionResult> {
  if (!(await signedIn())) return { ok: false, error: "not signed in" };
  if (!isValidArticleId(articleId)) return { ok: false, error: "invalid article" };

  const resolvedMinifluxId = await resolveMinifluxId(articleId, minifluxId).catch(() => null);
  if (!resolvedMinifluxId) return { ok: false, error: "article not found" };

  try {
    // Already read (Recently read, Later, Search): Undo would mark it unread
    // and push it back into Today. Nothing changes, so nothing to undo.
    if ((await entryState(resolvedMinifluxId)).read) return { ok: true, interactionId: 0 };
    await markRead([resolvedMinifluxId]);
  } catch (err) {
    console.error("archive: failed to mark read in Miniflux", err);
    return { ok: false, error: "could not archive" };
  }

  try {
    const interactionId = await insertInteraction(articleId, "archived");
    return { ok: true, interactionId };
  } catch (err) {
    console.error("archive: failed to log interaction, reverting read state", err);
    await markUnread(resolvedMinifluxId).catch((revertErr) => {
      console.error("archive: revert also failed, article is read with no interaction row", revertErr);
    });
    return { ok: false, error: "could not archive" };
  }
}

/**
 * Take a story out of Later. Before this there was no way to: Save was
 * idempotent and the reader's Save did nothing once saved, so Later only
 * grew. Not a training signal, so nothing is logged; undo is saveForLater.
 */
export async function removeFromLater(articleId: number, minifluxId?: number): Promise<ActionResult> {
  if (!(await signedIn())) return { ok: false, error: "not signed in" };
  if (!isValidArticleId(articleId)) return { ok: false, error: "invalid article" };
  const resolvedMinifluxId = await resolveMinifluxId(articleId, minifluxId).catch(() => null);
  if (!resolvedMinifluxId) return { ok: false, error: "article not found" };
  try {
    if (await entryStarred(resolvedMinifluxId)) await toggleStar(resolvedMinifluxId);
    return { ok: true, interactionId: 0 };
  } catch (err) {
    console.error("removeFromLater failed", err);
    return { ok: false, error: "could not remove" };
  }
}

/**
 * Reverts one interaction: deletes its app.interaction row and undoes
 * whatever Miniflux state change the original action made. Looks the row
 * up first so it knows which, read_later un-stars (toggleStar flips back),
 * archived marks the entry unread again.
 *
 * If the row is already gone (e.g. double-tapped Undo, or it was cleaned up
 * by a rollback above), that's treated as success, there's nothing left to
 * undo, not an error.
 */
export async function undoAction(interactionId: number): Promise<UndoResult> {
  if (!(await signedIn())) return { ok: false, error: "not signed in" };
  if (!Number.isInteger(interactionId) || interactionId <= 0) {
    return { ok: false, error: "invalid interaction" };
  }

  const { rows } = await pool.query<{ article_id: string; action: string }>(
    `select article_id, action from app.interaction where id = $1`,
    [interactionId]
  );
  const row = rows[0];
  if (!row) return { ok: true };

  const articleId = Number(row.article_id);

  try {
    if (row.action === "read_later" || row.action === "archived") {
      const minifluxId = await resolveMinifluxId(articleId);
      if (minifluxId) {
        if (row.action === "read_later") {
          await toggleStar(minifluxId);
        } else {
          await markUnread(minifluxId);
        }
      }
    }
    await pool.query(`delete from app.interaction where id = $1`, [interactionId]);
    return { ok: true };
  } catch (err) {
    console.error("undoAction failed", err);
    return { ok: false, error: "could not undo" };
  }
}

// lib/miniflux.ts exports markRead (what POST /api/read uses) but no
// "mark unread", nothing in the app needed to un-read an entry before
// Undo. Same endpoint and shape as markRead, opposite status; kept local
// to undo rather than added to lib/.
async function markUnread(entryId: number): Promise<void> {
  const url = process.env.MINIFLUX_URL;
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!url || !token) throw new Error("Miniflux environment variables are not set");

  const res = await fetch(`${url}/v1/entries`, {
    method: "PUT",
    headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ entry_ids: [entryId], status: "unread" }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Miniflux PUT /v1/entries (unread) failed: ${res.status} ${body}`);
  }
}
