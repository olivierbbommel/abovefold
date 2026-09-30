// Run: node --experimental-strip-types lib/read-ledger.test.ts
import assert from "node:assert/strict";

// A stand-in sessionStorage, so persistence across a module reload is tested too.
const store = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};

const { noteRead, forgetRead, wasRead, MAX_LEDGER } = await import("./read-ledger.ts");

// 1. A story read in the reader is hidden; undo brings it back.
assert.equal(wasRead(11439), false);
noteRead(11439);
assert.equal(wasRead(11439), true);
forgetRead(11439);
assert.equal(wasRead(11439), false);

// 2. Junk ids are ignored.
noteRead(0);
noteRead(-3);
noteRead(1.5);
assert.equal(wasRead(0), false);

// 3. Capped: the oldest entries fall out, the newest stay.
for (let i = 1; i <= MAX_LEDGER + 50; i++) noteRead(i);
assert.equal(wasRead(1), false);
assert.equal(wasRead(50), false);
assert.equal(wasRead(51), true);
assert.equal(wasRead(MAX_LEDGER + 50), true);

// 4. Re-reading an old id makes it newest, so it survives the next trim.
noteRead(51);
noteRead(100_000);
assert.equal(wasRead(51), true);
assert.equal(wasRead(52), false);

// 5. Persisted: a fresh module instance (a reload) sees the same ledger.
const reloaded = await import("./read-ledger.ts?reload=1");
assert.equal(reloaded.wasRead(100_000), true);
assert.equal(reloaded.wasRead(52), false);

// 6. Corrupt storage starts empty instead of throwing.
store.set("abovefold:read-ledger", "{not json");
const fresh = await import("./read-ledger.ts?reload=2");
assert.equal(fresh.wasRead(100_000), false);

console.log("read-ledger: all tests pass");
