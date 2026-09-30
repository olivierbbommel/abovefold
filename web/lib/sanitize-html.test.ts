// Run: node --experimental-strip-types lib/sanitize-html.test.ts
// Entity handling. The tempting fix for the double-escaped &nbsp; (keep entity
// references in attributes without decoding first) lets every encoded
// javascript: link through. These cases fail against that variant.
import { sanitizeHtml, decodeEntities } from "./sanitize-html.ts";

// Entity-encoded attacks: judged by what a BROWSER would see after decoding the output attribute.
const attacks = [
  `<a href="javascript&#58;alert(1)">x</a>`,
  `<a href="javascript&colon;alert(1)">x</a>`,
  `<a href="&#106;avascript:alert(1)">x</a>`,
  `<a href="&#x6A;avascript&#x3A;alert(1)">x</a>`,
  `<a href="java&Tab;script:alert(1)">x</a>`,
  `<a href="jav&#x09;ascript:alert(1)">x</a>`,
  `<a href="&#0000106avascript:alert(1)">x</a>`,
  `<a href="data&#58;text/html,<script>alert(1)</script>">x</a>`,
  `<img src="x" alt="&quot; onerror=&quot;alert(1)">`,
  `<a title="&lt;script&gt;alert(1)&lt;/script&gt;">t</a>`,
  `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`,
];
const decodeAttrOld = (h: string) =>
  h.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const decodeAttr = (h: string) => decodeEntities(h); // decode like a browser does
let bad = 0;
for (const a of attacks) {
  const out = sanitizeHtml(a);
  const urls = [...out.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
  const bodyLive = /<script|\son\w+\s*=/i.test(out.replace(/"[^"]*"/g, "\"\""));
  const urlLive = urls.some((h) => /^(javascript|vbscript|data):/i.test(h.replace(/[\u0000- ]/g, "")));
  if (bodyLive || urlLive) { bad++; console.log("  FAIL", a, "->", out); }
  else console.log("  ok  ", a.slice(0, 46).padEnd(48), "->", out.slice(0, 60));
}
const keep: [string, string][] = [
  [`<p>a&nbsp;b</p>`, `<p>a&nbsp;b</p>`],
  [`<p>Tom &amp; Jerry</p>`, `<p>Tom &amp; Jerry</p>`],
  [`<p>R&D and AT&T</p>`, `<p>R&amp;D and AT&amp;T</p>`],
  [`<a href="https://x.com/?a=1&amp;b=2">l</a>`, `<a href="https://x.com/?a=1&amp;b=2">l</a>`],
  [`<p>&#8217;quoted&#8217;</p>`, `<p>&#8217;quoted&#8217;</p>`],
];
for (const [i, want] of keep) {
  const o = sanitizeHtml(i);
  if (o !== want) { bad++; console.log("  FAIL keep", i, "->", o, "want", want); }
  else console.log("  ok   keep", i);
}
console.log(bad ? `${bad} FAILURES` : "ENTITY CASES PASS");
