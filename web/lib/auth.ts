import { createHmac, timingSafeEqual } from "node:crypto";

// Single-user auth.
// No registration, no password reset, one password from .env, exchanged for a
// signed session cookie.

export const COOKIE_NAME = "abovefold_session";

const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const SESSION_MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000;

function getSessionSecret(): string {
  const secret = process.env.ABOVEFOLD_SESSION_SECRET;
  if (!secret) {
    throw new Error("ABOVEFOLD_SESSION_SECRET is not set");
  }
  return secret;
}

function sign(expiry: string): string {
  return createHmac("sha256", getSessionSecret()).update(expiry).digest("hex");
}

/** Signed token: `<expiryMs>.<hmacHex>`, HMAC-SHA256 over the expiry timestamp. */
export function createSession(): string {
  const expiry = String(Date.now() + SESSION_DURATION_MS);
  return `${expiry}.${sign(expiry)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiry) || signature.length === 0) return false;

  const expected = sign(expiry);

  // timingSafeEqual throws on length mismatch, guard before calling it, and
  // compare the fixed-length digest rather than the raw (attacker-controlled
  // length) signature string.
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return false;

  return Date.now() < Number(expiry);
}

/** Timing-safe comparison against ABOVEFOLD_PASSWORD. */
export function verifyPassword(candidate: string): boolean {
  const expected = process.env.ABOVEFOLD_PASSWORD;
  if (!expected) return false;

  const expectedBuf = Buffer.from(expected);
  const candidateBuf = Buffer.from(candidate);
  if (expectedBuf.length !== candidateBuf.length) return false;

  return timingSafeEqual(expectedBuf, candidateBuf);
}
