// Run: node --experimental-strip-types lib/display-name.test.ts
import assert from "node:assert/strict";
import { displayName } from "./display-name.ts";
const cases: [string, string][] = [
  ["Engadget - Technology News & Expert Reviews", "Engadget"],
  ["MacRumors: Mac News and Rumors - All Stories", "MacRumors"],
  ["Hacker News: Front Page", "Hacker News"],
  ["All Content from Business Insider", "Business Insider"],
  ["Marketing Dive - Latest News", "Marketing Dive"],
  ["Rock Paper Shotgun Latest Articles Feed", "Rock Paper Shotgun"],
  ["TLDR Tech", "TLDR Tech"],
  ["Stratechery by Ben Thompson", "Stratechery by Ben Thompson"],
  ["Polygon.com", "Polygon.com"],
  ["NYT > Business > DealBook", "NYT"],
  ["AI: a very short title", "AI: a very short title"],
  ["", ""],
];
for (const [input, want] of cases) assert.equal(displayName(input), want, input);
assert.ok(displayName("A".repeat(60)).length <= 32);
console.log("display-name: all tests pass");
