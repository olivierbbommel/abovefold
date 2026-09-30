/**
 * Strict positive-integer route parameter.
 *
 * `Number()` is far too permissive for an id that arrives from a URL:
 * `Number("1200.")`, `Number(" 1200")`, `Number("0x4b0")` and `Number("1e3")`
 * all produce a clean integer that passes `Number.isInteger`. That leniency
 * was half of a real authentication bypass on 2026-08-27 (the other half was
 * the middleware matcher exempting any path containing a dot): `/article/1200.`
 * skipped the session check AND parsed as article 1200, so it served the
 * article to anyone.
 *
 * The matcher is fixed, but ids should not depend on the matcher being right.
 * Only digits, and nothing else, is an id.
 */
export function positiveIntParam(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
