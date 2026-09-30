// Run: node --experimental-strip-types lib/entities.test.ts
import assert from "node:assert/strict";
import { decodeEntities } from "./entities.ts";

assert.equal(decodeEntities("RFK Jr.&#039;s CDC"), "RFK Jr.'s CDC", "decimal with a leading zero");
assert.equal(decodeEntities("It&#39;s"), "It's");
assert.equal(decodeEntities("caf&#xE9; and caf&#XE9;"), "café and café", "hex, either case of x");
assert.equal(decodeEntities("Tom &amp; Jerry &quot;live&quot;"), 'Tom & Jerry "live"');
assert.equal(decodeEntities("Apple&rsquo;s &lsquo;one more thing&rsquo;"), "Apple’s ‘one more thing’");
assert.equal(decodeEntities("a &lt;b&gt; c"), "a <b> c");
assert.equal(decodeEntities("&amp;#039;"), "&#039;", "one pass: an escaped reference is not decoded twice");
assert.equal(decodeEntities("&amp;amp;"), "&amp;", "one pass for named references too");
assert.equal(decodeEntities("&bogus; &#99999999; &#xD800;"), "&bogus; &#99999999; &#xD800;", "unknown or invalid stays as written");
assert.equal(decodeEntities("AT&T and R&D"), "AT&T and R&D", "a bare ampersand is text");
assert.equal(decodeEntities("no entities"), "no entities");
console.log("entities: all tests pass");
