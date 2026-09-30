// Run: node --experimental-strip-types lib/safe-next.test.ts
import assert from "node:assert/strict";
import { safeNext } from "./safe-next.ts";

// Kept: same-site pages, with their query.
assert.equal(safeNext("/article/11434"), "/article/11434");
assert.equal(safeNext("/search?q=openai"), "/search?q=openai");
assert.equal(safeNext("/folder/2"), "/folder/2");

// Refused: anything that could leave the site or loop.
for (const bad of [
  "https://evil.example/", "//evil.example/", "/\\evil.example", "\\\\evil.example",
  "javascript:alert(1)", "/%0d%0aLocation:%20x", "/\u0000x", "/a\\b",
  "/login", "/login?next=/x", "/api/read", "", "x", 42, null, undefined, "/" + "a".repeat(600),
]) {
  const out = safeNext(bad);
  assert.equal(out === "/" || (typeof bad === "string" && out === bad && !bad.includes("\\")), true, `refused: ${String(bad)}`);
  assert.ok(out.startsWith("/") && !out.startsWith("//"), `stays on site: ${String(bad)} -> ${out}`);
}
assert.equal(safeNext("//evil.example/"), "/");
assert.equal(safeNext("https://evil.example/"), "/");
assert.equal(safeNext("/\\evil.example"), "/");
assert.equal(safeNext("/login"), "/");
assert.equal(safeNext("/api/read"), "/");

console.log("safe-next: all tests pass");
