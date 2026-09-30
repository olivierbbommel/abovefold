// Run: node --experimental-strip-types lib/add-format.test.ts
import assert from "node:assert/strict";
import { cardMeta, displayHost, linkedHereLine, longAgo, postsPerWeekText, readingCaption, shortAge, sourceList, tileLetter } from "./add-format.ts";

const now = Date.parse("2026-09-24T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;

assert.equal(shortAge(ago(12 * MIN), now), "12m");
assert.equal(shortAge(ago(10_000), now), "1m", "never 0m");
assert.equal(shortAge(ago(61 * MIN), now), "1h");
assert.equal(shortAge(ago(49 * 60 * MIN), now), "2d");
assert.equal(shortAge(ago(21 * 24 * 60 * MIN), now), "3w");
assert.equal(shortAge(null, now), "");

assert.equal(longAgo(ago(12 * MIN), now), "12 min ago", "under an hour is minutes, never 'today'");
assert.equal(longAgo(ago(60 * MIN), now), "1 hour ago");
assert.equal(longAgo(ago(5 * 60 * MIN), now), "5 hours ago");
assert.equal(longAgo(ago(24 * 60 * MIN), now), "1 day ago");
assert.equal(longAgo("not a date", now), null);

assert.equal(postsPerWeekText(41.2), "41 posts a week");
assert.equal(postsPerWeekText(1), "1 post a week", "singular");
assert.equal(postsPerWeekText(0.5), "under 1 post a week");
assert.equal(postsPerWeekText(0), "nothing in 30 days");

assert.equal(
  cardMeta("reuters.com", { postsPerWeek: 41, lastPostAt: ago(12 * MIN), fullTextAvailable: true }, now),
  "reuters.com · 41 posts a week · last post 12 min ago · full text"
);
assert.equal(
  cardMeta("hbr.org", { postsPerWeek: 3, lastPostAt: null, fullTextAvailable: false }, now),
  "hbr.org · 3 posts a week",
  "no full text is not announced, and a missing date is omitted"
);
assert.equal(cardMeta("x.org", null, now), "x.org");

assert.equal(sourceList(["Hacker News", "TLDR", "Engadget"]), "Hacker News and TLDR");
assert.equal(sourceList(["Hacker News", "Hacker News"]), "Hacker News");
assert.equal(sourceList([]), "");

const W = "in the last 60 days";
assert.equal(
  readingCaption({ appearances: 14, opened: 5, via: ["Hacker News", "TLDR"] }, W),
  "Linked 14 times by Hacker News and TLDR in the last 60 days · you opened 5"
);
assert.equal(
  readingCaption({ appearances: 9, opened: 0, via: ["Hacker News"] }, W),
  "Linked 9 times by Hacker News in the last 60 days",
  "no opens: the clause is omitted, not 'you opened 0'"
);
assert.equal(readingCaption({ appearances: 1, opened: 0, via: [] }, W), "Linked once in the last 60 days");

assert.equal(linkedHereLine({ appearances: 6, via: ["TLDR"] }, W), "TLDR has linked here 6 times in the last 60 days.");
assert.equal(
  linkedHereLine({ appearances: 6, via: ["TLDR", "Hacker News"] }, W),
  "TLDR and Hacker News have linked here 6 times in the last 60 days."
);

assert.equal(tileLetter("Ars Technica"), "A");
assert.equal(tileLetter("The Verge"), "V");
assert.equal(tileLetter("theregister.com"), "T", "only a separate word 'The' is skipped");
assert.equal(tileLetter("www.ft.com"), "F");
assert.equal(tileLetter("  "), "?");
assert.equal(displayHost("www.theregister.com"), "theregister.com");
assert.equal(displayHost("WWW.Example.COM."), "example.com");
assert.equal(displayHost("wwwhatsnew.com"), "wwwhatsnew.com", "only a www. label is stripped");
assert.equal(
  cardMeta("www.reuters.com", null, now),
  "reuters.com",
  "the card never shows www."
);
console.log("add-format: all tests pass");
