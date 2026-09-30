import { NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/safe-next";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  verifyPassword,
} from "@/lib/auth";
import {
  checkLoginAllowed,
  clearLoginFailures,
  clientKey,
  recordLoginFailure,
} from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const key = clientKey(request.headers);

  // Checked BEFORE reading the body or comparing the password, so a
  // locked-out client costs nothing beyond a Map lookup.
  const throttle = checkLoginAllowed(key);
  if (!throttle.allowed) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: "/login?error=throttled",
        "Retry-After": String(throttle.retryAfterSeconds),
      },
    });
  }

  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const next = safeNext(form?.get("next"));
  const keepNext = next === "/" ? "" : `&next=${encodeURIComponent(next)}`;

  if (typeof password !== "string" || !verifyPassword(password)) {
    recordLoginFailure(key);
    // Generic failure, no "wrong password" vs. "no password" distinction.
    // Relative Location. `new URL(..., request.url)` resolves against the
    // container's own address (0.0.0.0:3000 behind the tunnel), which sent
    // users to a dead host after login. RFC 7231 allows a relative Location
    // and it is correct behind any proxy without trusting forwarded headers.
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/login?error=1${keepNext}` },
    });
  }

  clearLoginFailures(key);

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: next },
  });
  response.cookies.set(COOKIE_NAME, createSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
