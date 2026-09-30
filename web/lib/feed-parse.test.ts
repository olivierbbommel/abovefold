// Run: node --experimental-strip-types lib/feed-parse.test.ts
import assert from "node:assert/strict";
import { feedLinksIn, looksLikeFeed, parseFeed, stripTags, titleOf } from "./feed-parse.ts";

const time = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

// 1. Pathological inputs that used to be quadratic finish fast. 280 KB of
//    unclosed <item> took 4.3 s with the old lazy regex; each case here is
//    bigger and must stay well under 250 ms.
const hostile = {
  unclosedItems: "<rss><channel>" + "<item>".repeat(100_000),
  unclosedTitles: "<rss><channel><item>" + "<title>".repeat(100_000),
  ltWithoutGt: "<rss><channel><item><description>" + "<".repeat(600_000),
  linkNoGt: "<html><head>" + "<link rel=alternate ".repeat(40_000),
  prefixRuns: "<rss>" + ("<" + "a".repeat(50) + " ").repeat(20_000),
};
for (const [name, doc] of Object.entries(hostile)) {
  const ms = time(() => {
    parseFeed(doc);
    stripTags(doc);
    titleOf(doc, "x");
    looksLikeFeed(doc);
    feedLinksIn(doc, new URL("https://example.com/"), "x");
  });
  assert.ok(ms < 250, `${name} took ${ms.toFixed(0)} ms`);
}

// 2. Item cap: a feed with 10,000 items is read to 50, not all of them.
const now = new Date().toUTCString();
const many = "<rss><channel>" + `<item><title>t</title><pubDate>${now}</pubDate></item>`.repeat(10_000) + "</channel></rss>";
assert.equal(parseFeed(many).volumeLast30Days, 50);

// 3. Correctness on real shapes: RSS with CDATA and content:encoded.
const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Example &amp; Co</title>
<item><title><![CDATA[First <b>post</b>]]></title><pubDate>${now}</pubDate>
<content:encoded><![CDATA[${"<p>long body</p>".repeat(100)}]]></content:encoded></item>
<item><title>Second &#8217;one&#8217;</title><pubDate>${now}</pubDate><description>short</description></item>
</channel></rss>`;
const p = parseFeed(rss);
assert.equal(p.volumeLast30Days, 2);
assert.deepEqual(p.recentItems.map((i) => i.title).sort(), ["First post", "Second ’one’"].sort());
assert.equal(titleOf(rss, "fallback"), "Example & Co");
assert.equal(looksLikeFeed(rss), true);

// 4. Namespaced Atom (hbr.org serves <ns6:feed>/<ns6:entry>).
const atom = `<?xml version="1.0"?><ns6:feed xmlns:ns6="http://www.w3.org/2005/Atom"><ns6:title>HBR</ns6:title>
<ns6:entry><ns6:title>Managing</ns6:title><ns6:updated>${new Date().toISOString()}</ns6:updated><ns6:summary>s</ns6:summary></ns6:entry>
</ns6:feed>`;
assert.equal(parseFeed(atom).volumeLast30Days, 1);
assert.equal(parseFeed(atom).recentItems[0].title, "Managing");
assert.equal(titleOf(atom, "x"), "HBR");

// 5. <media:content/> must not be mistaken for the item's content, and a
//    self-closing tag must not swallow the rest of the item.
const media = `<rss><channel><item><media:content url="x"/><title>Real</title><pubDate>${now}</pubDate></item></channel></rss>`;
assert.equal(parseFeed(media).recentItems[0].title, "Real");

// 6. HTML discovery: declared feeds, relative hrefs, comment feeds skipped,
//    private targets dropped, entity-encoded attributes decoded.
const page = `<html><head><title>The Site</title>
<link rel="alternate" type="application/rss+xml" title="Main feed" href="/feed/">
<link rel="alternate" type="application/rss+xml" title="Comments feed" href="/comments/feed/">
<link type='application/atom+xml' rel='alternate home' href='https://example.com/atom?a=1&amp;b=2'>
<link rel="alternate" type="application/rss+xml" href="http://127.0.0.1:8080/v1/me">
<link rel="alternate" type="application/rss+xml" href="http://miniflux.:8080/">
<link rel="stylesheet" href="/style.css">
<link rel="alternate" hreflang="fr" href="/fr/">
</head></html>`;
const links = feedLinksIn(page, new URL("https://example.com/blog/"), "The Site");
assert.deepEqual(links.map((l) => l.url), ["https://example.com/feed/", "https://example.com/atom?a=1&b=2"]);
assert.equal(links[0].title, "Main feed");
assert.equal(links[1].title, "The Site");
assert.equal(looksLikeFeed(page), false);

// 7. A title that names the format, not the site, falls back to the page title.
const yt = `<link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC1">`;
assert.equal(feedLinksIn(yt, new URL("https://www.youtube.com/@x"), "Veritasium")[0].title, "Veritasium");

console.log("feed-parse: all tests pass");
