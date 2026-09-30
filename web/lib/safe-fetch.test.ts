// Run: node --experimental-strip-types lib/safe-fetch.test.ts
import assert from "node:assert/strict";
import http from "node:http";
import { blockedTarget, fetchChecked, guardedLookup, mapLimit, privateAddress, readCapped, refused, vetPublicUrl } from "./safe-fetch.ts";

const blocked = (u: string) => blockedTarget(new URL(u));

// 1. Every bypass the security review found, plus the originals.
const mustBlock = [
  // compose services, with and without the trailing dot
  "http://db:5432/", "http://db.:5432/", "http://miniflux:8080/v1/me", "http://miniflux.:8080/v1/me",
  "http://web:3000/", "http://worker/", "http://abovefold-db-1:5432/", "http://abovefold-miniflux-1./",
  // local names
  "http://localhost/", "http://localhost./", "http://foo.localhost/", "http://printer.local/",
  "http://metadata.google.internal/", "http://router.lan/", "http://nas.home.arpa/",
  // IPv4 in every spelling
  "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/",
  "http://0.0.0.0/", "http://10.1.2.3/", "http://172.19.0.1:22/", "http://192.168.1.1/", "http://169.254.169.254/",
  "http://100.64.0.1/", "http://127.0.0.1./", "http://224.0.0.1/", "http://255.255.255.255/",
  // IPv6
  "http://[::1]/", "http://[::]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
  "http://[::7f00:1]/", "http://[64:ff9b::7f00:1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[fc00::1]/",
  "http://[::ffff:10.0.0.1]/", "http://[ff02::1]/",
  // schemes and credentials
  "file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "http://user:pw@example.com/",
];
for (const u of mustBlock) assert.equal(blocked(u), true, `should block ${u}`);

const mustAllow = [
  "https://example.com/", "https://www.theatlantic.com/feed/all/", "http://feeds.harvardbusiness.org/harvardbusiness",
  "https://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://sub.domain.co.uk./", "https://a.b.c.d.example.org:8443/x?y=1",
];
for (const u of mustAllow) assert.equal(blocked(u), false, `should allow ${u}`);

// 2. The address check used by the DNS layer.
for (const a of ["127.0.0.1", "10.0.0.5", "172.31.255.255", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fe80::1", "64:ff9b::a00:1", "not-an-ip"]) {
  assert.equal(privateAddress(a), true, `private: ${a}`);
}
for (const a of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) assert.equal(privateAddress(a), false, `public: ${a}`);

// 3. The connect-time lookup refuses a public-looking name that resolves to
//    loopback. `localhost` resolves via /etc/hosts, so this needs no network.
await new Promise<void>((resolve) => {
  guardedLookup("localhost", {}, (err) => {
    assert.equal(err?.code, "EPRIVATE", "localhost must be refused at lookup");
    resolve();
  });
});

// 4. End to end: a DNS name that resolves to loopback is refused by
//    fetchChecked even though its spelling passes blockedTarget. A real
//    server listens on loopback so a missing guard would visibly connect.
const server = http.createServer((_req, res) => res.end("internal secret"));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
let dnsName: string | null = null;
for (const name of ["localtest.me", "127.0.0.1.nip.io"]) {
  try {
    const { address } = await (await import("node:dns")).promises.lookup(name);
    if (address === "127.0.0.1") { dnsName = name; break; }
  } catch { /* offline: skip */ }
}
if (dnsName) {
  assert.equal(blocked(`http://${dnsName}:${port}/`), false, "spelling alone passes");
  const res = await fetchChecked(new URL(`http://${dnsName}:${port}/`), { timeoutMs: 5000 });
  assert.ok(refused(res), `${dnsName} -> 127.0.0.1 must be refused, got ${refused(res) ? "" : res.status}`);
  const vet = await vetPublicUrl(`http://${dnsName}:${port}/feed`);
  assert.ok("error" in vet, "vetPublicUrl must refuse a name resolving to loopback");
  console.log(`  dns rebinding-style name ${dnsName} refused`);
} else {
  console.log("  (no network DNS: skipped the resolving-name check)");
}

// 5. A redirect from an allowed hop into a blocked one is refused per hop.
//    Simulated: the literal loopback target itself is refused before connecting.
const direct = await fetchChecked(new URL(`http://127.0.0.1:${port}/`), { timeoutMs: 2000 });
assert.ok(refused(direct), "loopback literal refused before any connection");
server.close();

// 6. readCapped stops reading at the cap and reports truncation.
const big = new Response(new ReadableStream({
  start(c) { for (let i = 0; i < 100; i++) c.enqueue(new Uint8Array(10_000)); c.close(); },
}));
const capped = await readCapped(big as never, 25_000);
assert.equal(capped.bytes.byteLength, 25_000);
assert.equal(capped.truncated, true);
const small = await readCapped(new Response("hello") as never, 25_000);
assert.equal(small.bytes.toString(), "hello");
assert.equal(small.truncated, false);

// 7. mapLimit keeps order and never exceeds the limit.
let inFlight = 0, peak = 0;
const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
  inFlight++; peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, n * 3));
  inFlight--;
  return n * 10;
});
assert.deepEqual(out, [50, 10, 40, 20, 30]);
assert.ok(peak <= 2, `peak concurrency ${peak}`);

console.log("safe-fetch: all tests pass");
