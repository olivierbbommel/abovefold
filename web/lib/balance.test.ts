// Run: node --experimental-strip-types lib/balance.test.ts
import assert from "node:assert/strict";
import { balanceByFolder } from "./balance.ts";

const folder: Record<number, number> = { 1: 10, 2: 10, 3: 20, 4: 30, 5: 30 };
const folderOf = (f: number) => folder[f] ?? null;
const mk = (spec: string) => spec.split(" ").map((t, i) => ({ id: `${t}#${i}`, feedId: Number(t) }));
const f = (s: { feedId: number }) => folderOf(s.feedId);

// 1. A tech-heavy ranking: every prefix respects ceil(k/3) per folder, when
//    other folders have enough news to make that possible (test 5 covers
//    the case where they do not).
{
  const ranked = mk("1 2 1 2 1 3 4 3 5 3 4 5 2 1");
  const out = balanceByFolder(ranked, folderOf, 9);
  for (let k = 1; k <= out.length; k++) {
    const cap = Math.ceil(k / 3);
    const n10 = out.slice(0, k).filter((s) => f(s) === 10).length;
    assert.ok(n10 <= cap, `prefix ${k}: folder 10 has ${n10} > ${cap}`);
  }
}
// 2. The visible top of the list is balanced: the first three come from three folders.
{
  const out = balanceByFolder(mk("1 2 1 2 3 4"), folderOf, 6);
  assert.equal(new Set(out.slice(0, 3).map(f)).size, 3, "top three must span three folders");
}
// 3. The best story always leads.
{
  const ranked = mk("1 2 3 4");
  assert.equal(balanceByFolder(ranked, folderOf, 4)[0], ranked[0]);
}
// 4. Within a folder, rank order is preserved.
{
  const ranked = mk("1 2 1 3 2 4 1 5");
  const out = balanceByFolder(ranked, folderOf, 8);
  const tech = out.filter((s) => f(s) === 10).map((s) => ranked.indexOf(s));
  assert.deepEqual(tech, [...tech].sort((a, b) => a - b), "same-folder stories must keep rank order");
}
// 5. Never shorter: with only one folder present, fill anyway.
assert.equal(balanceByFolder(mk("1 2 1 2 1"), folderOf, 4).length, 4, "balance must never shrink Today");
// 6. Unfiled feeds count as their own bucket.
assert.equal(balanceByFolder(mk("9 9 9 3 4"), folderOf, 3).filter((s) => s.feedId === 9).length, 1);
// 7. Edge cases.
assert.deepEqual(balanceByFolder([], folderOf, 5), []);
assert.deepEqual(balanceByFolder(mk("1 2"), folderOf, 0), []);
console.log("balance: all tests pass");
