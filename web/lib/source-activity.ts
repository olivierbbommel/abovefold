import { pool } from "./db";

/*
 * What a folder or source page says about its sources (spec 5.6, audit A19).
 *
 * sourceStats() in queries.ts divides opens by opens plus skips. Skips are
 * almost never recorded, so that rate read 100% for every source and carried
 * nothing. This counts what actually happened instead: stories delivered in
 * the last 30 days, and how many of those the reader really opened (an
 * `opened` interaction is only written by the reader page, never by
 * mark-read-on-scroll). The caller shows the pair only once there are at
 * least MIN_SAMPLE stories behind it.
 */
export const MIN_SAMPLE = 10;

export type SourceActivity = {
  /** Stories published in the last 24 hours. */
  new24h: number;
  /** Stories published in the last 30 days. */
  delivered30d: number;
  /** Of those, how many were opened in the reader. */
  opened30d: number;
};

export async function sourceActivity(feedIds: number[]): Promise<Record<number, SourceActivity>> {
  const result: Record<number, SourceActivity> = {};
  for (const id of feedIds) result[id] = { new24h: 0, delivered30d: 0, opened30d: 0 };
  if (feedIds.length === 0) return result;

  const { rows } = await pool.query<{ feed_id: string; new24h: string; delivered: string; opened: string }>(
    `select a.feed_id,
            count(*) filter (where a.published_at > now() - interval '24 hours') as new24h,
            count(*) as delivered,
            count(*) filter (
              where exists (select 1 from app.interaction i where i.article_id = a.id and i.action = 'opened')
            ) as opened
       from app.article a
      where a.feed_id = any($1)
        and a.published_at > now() - interval '30 days'
        and not a.hidden
      group by a.feed_id`,
    [feedIds],
  );
  for (const row of rows) {
    result[Number(row.feed_id)] = {
      new24h: Number(row.new24h),
      delivered30d: Number(row.delivered),
      opened30d: Number(row.opened),
    };
  }
  return result;
}

/** "opened 5 of 42", or null when there is not enough behind it to mean anything. */
export function openedLabel(a: SourceActivity | undefined): string | null {
  if (!a || a.delivered30d < MIN_SAMPLE) return null;
  return `opened ${a.opened30d} of ${a.delivered30d}`;
}

/** "~15 a day", "~0.4 a day". */
export function volumeLabel(volumePerDay: number): string {
  const v = volumePerDay < 1 ? volumePerDay.toFixed(1) : String(Math.round(volumePerDay));
  return `~${v} a day`;
}
