export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { publicHost } from "./lib/public-url";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { pool } from "@/lib/db";

/*
 * Authentication gate for the whole app.
 *
 * The matcher runs middleware on EVERYTHING except Next's own build output.
 * What may skip the session cookie is then decided here, by exact pathname or
 * exact path segment, never by a pattern over the URL.
 *
 * That shape is deliberate and was bought the hard way. The matcher used to
 * carry the exemptions itself, ending in `.*\..*`: any path containing a dot
 * anywhere. That was a live, unauthenticated read of the entire reader, found
 * 2026-08-27 by fuzzing:
 *
 *   /article/1200.  -> middleware skipped (it has a dot), Next still routed it
 *                      to article/[id], and Number("1200.") is 1200, so the
 *                      page served the article to anyone on the internet.
 *   /feed/1.png     -> even once ids were parsed strictly and the page 404'd,
 *                      the (app) layout above it still rendered, leaking the
 *                      full subscription list, folder names, unread counts and
 *                      today's headlines. A 404 body is not a closed door when
 *                      a shared layout renders around it.
 *
 * The lesson generalises past the dot: any URL pattern clever enough to
 * describe "static files" is also clever enough to be smuggled past, because
 * Next's router and the regex disagree about where a route ends. An explicit
 * list cannot disagree with itself.
 *
 * Never move an exemption back into the matcher.
 */
export const config = {
  matcher: ["/((?!_next/).*)"],
};

/*
 * Path prefixes that skip the cookie, matched by whole segment. Each has a
 * reader that has no session and cannot get one:
 *
 *   /login, /api/login    the login flow itself
 *   /v1, /googlereader    native clients (Reeder, NetNewsWire) authenticate to
 *                         Miniflux directly with X-Auth-Token; behind this
 *                         cookie they break with no visible error
 *   /proxy                Miniflux's media proxy, which serves every thumbnail
 *                         (its URLs are HMAC-signed by Miniflux, so it is not
 *                         an open proxy)
 *   /api/newsletter       Miniflux polling a generated newsletter feed
 *   /api/inbound-email    the Cloudflare Email Worker delivering a message
 *   /newsletter           the worker fetching an issue to extract its text
 *
 * The last three are authorised by an unguessable token or a shared secret
 * instead. See web/lib/newsletter.ts and web/app/api/inbound-email/route.ts.
 *
 * `/api/newsletter` must NOT also match `/api/newsletter-address`, which
 * creates and deletes addresses. Segment matching is what prevents that; a
 * bare string prefix would not.
 */
const COOKIE_EXEMPT_PREFIXES = [
  "/login",
  "/api/login",
  "/v1",
  "/googlereader",
  "/proxy",
  "/api/newsletter",
  "/api/inbound-email",
  "/newsletter",
];

/*
 * Static files that must be readable without a session, listed exactly.
 * The login page and the PWA install prompt need these before anyone has a
 * cookie. Everything else in public/ is boilerplate and stays behind the gate.
 */
const PUBLIC_FILES = new Set([
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);

function skipsCookie(pathname: string): boolean {
  if (PUBLIC_FILES.has(pathname)) return true;
  return COOKIE_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// Hosts a forwarded Host header may name; anything else falls back to the
// configured public host, so a spoofed header cannot become an open redirect.
const allowedHosts = () => [publicHost(), "127.0.0.1", "localhost"];

// Reachable even before onboarding has been completed or skipped: the
// welcome flow itself, and the endpoints it calls to import feeds.
const ONBOARDING_EXEMPT = ["/welcome", "/api/onboarding", "/api/opml", "/api/starter-packs"];

// Once onboarding is done it is done forever, so remember it in a cookie
// rather than querying Postgres on every single request. Middleware runs on
// every navigation; a per-request round trip there is a tax on the whole app.
// Not security-sensitive: the worst case for a forged value is seeing (or
// skipping) the welcome flow.
const ONBOARDED_COOKIE = "abovefold_onboarded";

export async function middleware(request: NextRequest) {
  if (skipsCookie(request.nextUrl.pathname)) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (verifySession(token)) {
    const { pathname } = request.nextUrl;
    const exempt = ONBOARDING_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    const alreadyKnown = request.cookies.get(ONBOARDED_COOKIE)?.value === "1";
    if (!exempt && !alreadyKnown) {
      // First-run gate: redirect to /welcome until onboarding is complete
      // or explicitly skipped (app.user_state.onboarded_at, set by
      // POST /api/onboarding). Fails open on a DB error, because this must never
      // trap the user behind onboarding.
      try {
        const { rows } = await pool.query<{ onboarded_at: Date | null }>(
          `select onboarded_at from app.user_state where id = 1`
        );
        if (rows[0]?.onboarded_at != null) {
          // Remember it so this query never runs again for this browser.
          const done = NextResponse.next();
          done.cookies.set(ONBOARDED_COOKIE, "1", {
            httpOnly: true, sameSite: "lax", secure: true, path: "/",
            maxAge: 60 * 60 * 24 * 365,
          });
          return done;
        }
        {
          const forwarded = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
          const host = allowedHosts().some((h) => forwarded === h || forwarded.startsWith(`${h}:`))
            ? forwarded
            : publicHost();
          const proto = host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https";
          return NextResponse.redirect(new URL("/welcome", `${proto}://${host}`), 307);
        }
      } catch {
        // fail open: DB hiccups must not trap the user on /welcome.
      }
    }
    return NextResponse.next();
  }

  // Next's middleware parses Location itself and rejects a relative value,
  // so this must be absolute, but it must NOT be built from request.url,
  // which is the container's internal address (0.0.0.0:3000) behind the
  // Cloudflare tunnel and sends users to a dead host after login.
  //
  // Build it from the forwarded host, allowlisted so a spoofed Host header
  // cannot turn this into an open redirect.
  const forwarded = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const host = allowedHosts().some((h) => forwarded === h || forwarded.startsWith(`${h}:`))
    ? forwarded
    : publicHost();
  const proto = host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https";
  const target = new URL("/login", `${proto}://${host}`);
  // Come back here after login (validated again by safeNext on the way out).
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/" && !pathname.startsWith("/api/")) target.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(target, 307);
}
