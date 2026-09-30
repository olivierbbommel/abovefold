// Run: node --experimental-strip-types lib/resolve-input.test.ts
import assert from "node:assert/strict";
import { parseInput, nameSlugs, nameCandidates, classifyInput, emailLabel, hostOf } from "./resolve-input.ts";

assert.deepEqual(parseInput("   "), { kind: "empty" });
assert.equal(parseInput("r/worldnews").kind, "subreddit");
assert.equal((parseInput("https://www.reddit.com/r/cycling/") as any).url, "https://www.reddit.com/r/cycling/.rss");
assert.equal(parseInput("@veritasium").kind, "youtube");
assert.equal(parseInput("theatlantic.com").kind, "url");
assert.equal(parseInput("https://example.com/feed").kind, "url");
assert.equal(parseInput("tldr.tech/api/rss/tech").kind, "url");
assert.deepEqual(parseInput("The  Atlantic"), { kind: "name", name: "The Atlantic" });
assert.equal(parseInput("Rest of World").kind, "name", "a phrase with spaces is a name even if it has a dot later");

assert.deepEqual(nameSlugs("The Atlantic"), ["theatlantic", "atlantic", "the-atlantic"]);
assert.deepEqual(nameSlugs("Reuters"), ["reuters", "thereuters"]);
assert.deepEqual(nameSlugs("Café & Co"), ["cafeandco", "thecafeandco", "cafe-and-co"]);

// A host from the owner's reading beats every guess.
const c = nameCandidates("The Guardian", ["theguardian.com", "bbc.com"]);
assert.deepEqual(c[0], { host: "theguardian.com", from: "reading" });
assert.ok(!c.slice(1).some((x) => x.host === "theguardian.com"), "no duplicate of the reading host");
// With no reading match, candidates are pure guesses in order.
assert.deepEqual(nameCandidates("Reuters", [], 2), [
  { host: "reuters.com", from: "guess" },
  { host: "reuters.org", from: "guess" },
]);
// The chip (spec 5.4 classifier table).
const kind = (s: string) => classifyInput(s).kind;
assert.equal(kind(""), "empty");
assert.equal(kind("Reuters"), "name");
assert.equal(classifyInput("The Atlantic").chip, "Publication name");
assert.equal(kind("theverge.com"), "url");
assert.equal(classifyInput("https://www.theverge.com/tech").chip, "Link");
assert.deepEqual(classifyInput("r/worldnews"), { kind: "subreddit", chip: "Subreddit r/worldnews" });
assert.equal(kind("/r/cycling"), "subreddit");
assert.equal(kind("@veritasium"), "youtube");
assert.equal(kind("https://www.youtube.com/@veritasium"), "youtube", "a channel URL is YouTube, not a plain link");
assert.equal(kind("youtube.com/channel/UC123abc"), "youtube");
assert.equal(kind("https://www.youtube.com/watch?v=abc"), "url", "a single video is not a channel");
assert.equal(kind("https://example.com/feed"), "feed");
assert.equal(kind("example.com/feed/"), "feed");
assert.equal(kind("tldr.tech/api/rss/tech"), "url", "rss in the middle of a path is not a feed ending");
assert.equal(kind("https://hnrss.org/frontpage.xml"), "feed");
assert.equal(kind("https://blog.example.com/index.rss?x=1"), "feed");
assert.equal(kind("https://example.com/atom"), "feed");
assert.equal(kind("https://feedsite.com/"), "url", "'feed' inside a host name is not a feed path");
assert.equal(kind("Gates Notes newsletter"), "email");
assert.equal(kind("stratechery by email"), "email");
assert.equal(kind("email"), "email");
assert.equal(kind("Emailing tips"), "name", "a word that merely starts with email is a name");
assert.equal(kind("substack.com/newsletter"), "url", "an address stays an address even with the word in it");
assert.equal(emailLabel("Gates Notes newsletter"), "Gates Notes");
assert.equal(emailLabel("follow Stratechery by email"), "Stratechery");
assert.equal(emailLabel("newsletter"), "");
assert.equal(hostOf("https://www.Reuters.com/world"), "reuters.com");
assert.equal(hostOf("gatesnotes.com"), "gatesnotes.com");
console.log("resolve-input: all tests pass");

// A typed email address goes to the email step, named after its site.
assert.equal(kind("news@stratechery.com"), "email");
assert.equal(kind("  dan@tldrnewsletter.com "), "email");
assert.equal(kind("stratechery.com"), "url", "a domain alone is still a link");
assert.equal(emailLabel("news@stratechery.com"), "Stratechery");
assert.equal(emailLabel("hello@mail.substack.com"), "Substack");
assert.equal(emailLabel("Gates Notes newsletter"), "Gates Notes");
console.log("email address cases pass");
