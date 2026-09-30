/*
 * Outbound HTTP that refuses to touch the private network.
 *
 * Every server-side fetcher in the app shares this. It was originally inline
 * in /api/img, which meant the next route to fetch a user-supplied URL
 * started again from zero. A security boundary implemented once per route is
 * a boundary that will eventually be implemented wrong.
 *
 * Two layers, because a string test on the hostname can never be enough:
 *
 *   1. blockedTarget() rejects what is visible in the URL itself: private IP
 *      literals in every numeric spelling, local-only names, and dotless
 *      names (which are how compose services such as `db` and `miniflux` are
 *      reached, with or without a trailing dot).
 *   2. The dispatcher's DNS lookup rejects a public-looking name that resolves
 *      to a private address (`127.0.0.1.nip.io`, `localtest.me`, a rebinding
 *      domain). The check runs inside the connection's own lookup, so the
 *      address that was vetted is the address that is connected to: there is
 *      no window between "resolve and check" and "resolve and connect".
 *
 * The worker has its own copy of this idea in Python:
 * worker/abovefold_worker/safe_fetch.py. Keep the two in step.
 */
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

const MAX_REDIRECTS = 3;

export type CheckedResponse = UndiciResponse;
export type FetchRefusal = { error: string; status: number };

// One list per family: a BlockList checks IPv4 addresses against IPv6 rules
// in mapped form, so the ::ffff:0:0/96 rule below would match every IPv4
// address if the two shared a list.
const PRIVATE_V4 = new net.BlockList();
const PRIVATE_V6 = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE_V4.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [
  ["::", 128], ["::1", 128],
  ["::", 96],             // IPv4-compatible (deprecated), e.g. [::7f00:1]
  ["::ffff:0:0", 96],     // IPv4-mapped, e.g. [::ffff:7f00:1]
  ["64:ff9b::", 96],      // NAT64, e.g. [64:ff9b::7f00:1]
  ["64:ff9b:1::", 48],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) PRIVATE_V6.addSubnet(prefix, bits, "ipv6");

/** True for any address a server-side fetch must never reach. */
export function privateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return PRIVATE_V4.check(address, "ipv4");
  if (family === 6) return PRIVATE_V6.check(address, "ipv6");
  return true; // not an address at all: refuse rather than guess
}

/*
 * Is this URL safe to fetch server-side, judged from the URL alone?
 * DNS names that pass here are checked again at connect time.
 */
export function blockedTarget(target: URL): boolean {
  if (target.protocol !== "http:" && target.protocol !== "https:") return true;
  if (target.username || target.password) return true;

  // `db.` and `db` are the same name to a resolver, so drop trailing dots
  // before any comparison. `miniflux.:8080` got through the old literal list.
  let host = target.hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") && host.endsWith("]")) return privateAddress(host.slice(1, -1));
  if (!host) return true;

  // Every numeric spelling of IPv4 (2130706433, 0x7f000001, 0177.0.0.1).
  const octets = ipv4Octets(host);
  if (octets) return privateAddress(octets.join("."));

  // A name with no dot is a local name by definition: compose services,
  // container names (`abovefold-db-1`), search-domain shortcuts.
  if (!host.includes(".")) return true;
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa|localdomain)$/.test(host)) return true;
  return false;
}

function ipv4Octets(host: string): number[] | null {
  const dotted = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const parts = dotted.slice(1).map(Number);
    return parts.every((n) => n <= 255) ? parts : null;
  }
  // Decimal (2130706433), hex (0x7f000001) and octal (0177...) all parse as
  // a single 32-bit integer in every resolver that matters.
  let value: number | null = null;
  if (/^\d+$/.test(host)) value = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) value = parseInt(host, 16);
  else if (/^0[0-7]+$/.test(host)) value = parseInt(host, 8);
  if (value === null || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;

/*
 * Resolve every address for the name and refuse the connection if ANY of
 * them is private. Checking only the first would let a name with one public
 * and one private record through on the second attempt.
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => privateAddress(a.address))) {
      const refused: NodeJS.ErrnoException = new Error(`refused: ${hostname} resolves to a private address`);
      refused.code = "EPRIVATE";
      return callback(refused);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/*
 * For URLs handed to Miniflux, which fetches them itself with private
 * networks allowed (it must, to poll the newsletter feeds this app serves on
 * the compose network). This cannot pin Miniflux's own later lookups, so a
 * domain that changes its DNS after subscribing is outside what the app can
 * police; it does stop every address that is private at the time of adding.
 */
export async function vetPublicUrl(raw: string): Promise<URL | FetchRefusal> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "that does not look like a URL", status: 400 };
  }
  if (blockedTarget(url)) return { error: "that address is on a private network", status: 400 };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url; // literals were fully judged by blockedTarget
  try {
    const addresses = await dns.promises.lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => privateAddress(a.address))) {
      return { error: "that address is on a private network", status: 400 };
    }
  } catch {
    return { error: "that site's name does not resolve", status: 400 };
  }
  return url;
}

const dispatcher = new Agent({ connect: { lookup: guardedLookup as never }, connections: 16 });

/*
 * Follow redirects by hand so every hop is checked. `redirect: "follow"`
 * validated only the URL the caller supplied, so any public host could 302
 * the fetch straight into the private network.
 */
export async function fetchChecked(
  start: URL,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<CheckedResponse | FetchRefusal> {
  let target = start;
  const signal = AbortSignal.timeout(init.timeoutMs ?? 10_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (blockedTarget(target)) return { error: "blocked host", status: 400 };
    let response: CheckedResponse;
    try {
      response = await undiciFetch(target, {
        redirect: "manual",
        headers: {
          "User-Agent": "abovefold/1.0 (+https://github.com/olivierbbommel/abovefold)",
          ...(init.headers ?? {}),
        },
        signal,
        dispatcher,
      });
    } catch (err) {
      if (causeCode(err) === "EPRIVATE") return { error: "blocked host", status: 400 };
      throw err;
    }
    if (response.status < 300 || response.status > 399) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    try {
      target = new URL(location, target);
    } catch {
      return { error: "bad redirect", status: 502 };
    }
  }
  return { error: "too many redirects", status: 502 };
}

export function refused(result: CheckedResponse | FetchRefusal): result is FetchRefusal {
  return "error" in result && !("headers" in result);
}

function causeCode(err: unknown): string | undefined {
  for (let e = err as { code?: string; cause?: unknown } | undefined, depth = 0; e && depth < 5; depth++) {
    if (e.code) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

/*
 * Read at most maxBytes of a body, then abandon the rest. A hostile or
 * simply enormous page must not be able to make the server buffer it all.
 */
export async function readCapped(response: CheckedResponse, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: Buffer.alloc(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total += room;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { bytes: Buffer.concat(chunks, total), truncated };
}

export async function readCappedText(response: CheckedResponse, maxBytes: number): Promise<string> {
  return (await readCapped(response, maxBytes)).bytes.toString("utf8");
}

/** Run fn over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}
