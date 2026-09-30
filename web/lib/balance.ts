/*
 * Folder balance for Today.
 *
 * Ranked purely by score, Today mirrors whatever the source list leans
 * towards: a mostly-tech list gives a mostly-tech front page. "Balance by
 * folder" means no single folder dominates, while the ranker still decides.
 *
 * Balance holds for EVERY PREFIX of the list, not just the whole of it. The
 * first version capped the 30-story list at a third per folder and kept rank
 * order, which was correct and invisible: home shows the top 8, and those were
 * untouched. What the owner sees is always a prefix, so the rule is applied
 * position by position: at position k a folder may hold at most
 * ceil(k * share) of the stories so far. With share 1/3 the first three
 * stories come from three different folders when three folders have news.
 *
 * Guarantees, each covered by a test:
 *   - never shorter: if only one folder has news, it fills the list;
 *   - within a folder, rank order is preserved (balance only interleaves);
 *   - the top-ranked story is always first.
 *
 * Pure and dependency free so it can be tested without a database.
 */

export const DEFAULT_FOLDER_SHARE = 1 / 3;

export function balanceByFolder<T extends { feedId: number }>(
  ranked: readonly T[],
  folderOf: (feedId: number) => number | null,
  limit: number,
  share: number = DEFAULT_FOLDER_SHARE
): T[] {
  if (limit <= 0) return [];
  const keyOf = (item: T) => {
    const folder = folderOf(item.feedId);
    return folder === null ? "unfiled" : String(folder);
  };
  const remaining = [...ranked];
  const counts = new Map<string, number>();
  const out: T[] = [];

  while (out.length < limit && remaining.length > 0) {
    const cap = Math.max(1, Math.ceil((out.length + 1) * share));
    let pick = remaining.findIndex((item) => (counts.get(keyOf(item)) ?? 0) < cap);
    if (pick === -1) pick = 0; // nothing else has news: fill in rank order
    const [item] = remaining.splice(pick, 1);
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    out.push(item);
  }
  return out;
}
