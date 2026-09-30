// Run: node --experimental-strip-types lib/img.test.ts
import assert from "node:assert/strict";
import { cleanImageUrl, proxied } from "./img.ts";

// 1. Stray object-replacement characters in front of the URL are dropped
//    (the exact shape stored for a Simon Willison lead image).
assert.equal(
  cleanImageUrl("\uFFFC\uFFFC https://static.simonwillison.net/x.jpg"),
  "https://static.simonwillison.net/x.jpg"
);
// 2. Zero-width characters, a BOM and surrounding whitespace go too.
assert.equal(cleanImageUrl(" \u200Bhttps://a.test/\u200Dimg\uFEFF.png\u2060\n"), "https://a.test/img.png");
// 3. A clean URL is untouched.
assert.equal(cleanImageUrl("https://a.test/a%20b.png"), "https://a.test/a%20b.png");
// 4. proxied() builds the proxy URL from the cleaned value, not the raw one.
assert.equal(
  proxied("\uFFFChttps://static.simonwillison.net/x.jpg", "https://simonwillison.net/post", 720),
  `/api/img?u=${encodeURIComponent("https://static.simonwillison.net/x.jpg")}&w=720`
);
// 5. Nothing but invisible characters is no image at all.
assert.equal(proxied("\uFFFC \u200B", "https://a.test/"), null);

console.log("img: all tests pass");
