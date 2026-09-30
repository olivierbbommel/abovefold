/*
 * What did the user type into the Add box?
 *
 * Pure, so it can be tested without a network. The rules are deliberately
 * mechanical: nothing here knows about any particular publication. The owner
 * said they curate their own sources, so the resolver may only transform
 * what was typed, or match it against sites their own reading already
 * points at. It never suggests anything from a list we chose.
 */

export type ParsedInput =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "subreddit"; url: string; label: string }
  | { kind: "youtube"; url: string; label: string }
  | { kind: "name"; name: string };

export function parseInput(raw: string): ParsedInput {
  const q = raw.trim();
  if (q.length === 0) return { kind: "empty" };

  const sub = q.match(/^(?:https?:\/\/)?(?:www\.|old\.)?(?:reddit\.com)?\/?r\/([A-Za-z0-9_]{2,40})\/?$/i);
  if (sub) {
    return { kind: "subreddit", url: `https://www.reddit.com/r/${sub[1]}/.rss`, label: `r/${sub[1]}` };
  }
  const handle = q.match(/^@([A-Za-z0-9._-]{3,60})$/);
  if (handle) {
    return { kind: "youtube", url: `https://www.youtube.com/@${handle[1]}`, label: `@${handle[1]} on YouTube` };
  }
  // Anything with a scheme, or a single token containing a dot, is an address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || (!/\s/.test(q) && /\.[a-z]{2,}(?:[/:?#]|$)/i.test(q))) {
    return { kind: "url", url: q };
  }
  return { kind: "name", name: q.replace(/\s+/g, " ") };
}

/*
 * The chip under the Add box (spec 5.4). Runs on every keystroke in the
 * browser, so it never touches the network. It is a finer reading of the
 * same input as parseInput: the server only needs to know "address or
 * name", the person also wants to see "that is a feed link" or "that is a
 * newsletter".
 */
export type InputKind = "empty" | "url" | "feed" | "subreddit" | "youtube" | "email" | "name";

export type Classified = { kind: InputKind; chip: string };

const FEED_PATH = /(?:\.(?:xml|rss|atom)|\/(?:feed|atom|rss))\/?(?:[?#].*)?$/i;
const YOUTUBE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:@[^/\s]+|channel\/[^/\s]+|c\/[^/\s]+|user\/[^/\s]+)/i;
const EMAIL_WORDS = /\b(?:newsletters?|by e-?mail|e-?mail)\b/i;

const EMAIL_ADDRESS = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export function classifyInput(raw: string): Classified {
  if (EMAIL_ADDRESS.test(raw.trim())) return { kind: "email", chip: "Follow by email" };
  const parsed = parseInput(raw);
  switch (parsed.kind) {
    case "empty":
      return { kind: "empty", chip: "" };
    case "subreddit":
      return { kind: "subreddit", chip: `Subreddit ${parsed.label}` };
    case "youtube":
      return { kind: "youtube", chip: "YouTube channel" };
    case "url":
      if (YOUTUBE_URL.test(parsed.url)) return { kind: "youtube", chip: "YouTube channel" };
      if (FEED_PATH.test(parsed.url)) return { kind: "feed", chip: "Feed link" };
      return { kind: "url", chip: "Link" };
    case "name":
      if (EMAIL_WORDS.test(parsed.name)) return { kind: "email", chip: "Follow by email" };
      return { kind: "name", chip: "Publication name" };
  }
}

/** "Gates Notes newsletter" -> "Gates Notes": what is left once the email words are gone. */
export function emailLabel(raw: string): string {
  // news@stratechery.com -> "Stratechery": the sender's site names it best.
  const address = raw.trim().match(EMAIL_ADDRESS) ? raw.trim().split("@")[1].split(".") : null;
  if (address) {
    const name = address.length > 2 && /^(mail|news|email|e)$/i.test(address[0]) ? address[1] : address[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return raw
    .replace(/^\s*follow\s+/i, " ")
    .replace(/\bby e-?mail\b/gi, " ")
    .replace(/\b(?:newsletters?|e-?mail)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Host of a typed address, without www. Null when it is not an address. */
export function hostOf(raw: string): string | null {
  try {
    const q = raw.trim();
    return new URL(q.includes("://") ? q : `https://${q}`).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** "The Atlantic" -> ["theatlantic", "atlantic"]; "Rest of World" -> ["restofworld"]. */
export function nameSlugs(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const slugs = [words.join("")];
  if (words[0] === "the" && words.length > 1) slugs.push(words.slice(1).join(""));
  else slugs.push(`the${words.join("")}`);
  if (words.length > 1) slugs.push(words.join("-"));
  return [...new Set(slugs)].filter((s) => s.length >= 2);
}

const TLDS = ["com", "org", "net", "co.uk", "co", "io", "news"];

export type HostCandidate = { host: string; from: "reading" | "guess" };

/**
 * Hosts to try for a typed name, best first. Sites the owner's own reading
 * already links to come first (a real signal), then mechanical guesses.
 */
export function nameCandidates(name: string, readingHosts: readonly string[], max = 6): HostCandidate[] {
  const slugs = nameSlugs(name);
  if (slugs.length === 0) return [];
  const out: HostCandidate[] = [];
  const seen = new Set<string>();
  const push = (host: string, from: HostCandidate["from"]) => {
    if (seen.has(host)) return;
    seen.add(host);
    out.push({ host, from });
  };
  const bare = (h: string) => h.replace(/^www\./, "").split(".")[0].replace(/-/g, "");
  for (const host of readingHosts) {
    const b = bare(host);
    if (slugs.some((s) => s.replace(/-/g, "") === b)) push(host, "reading");
  }
  for (const slug of slugs) for (const tld of TLDS) push(`${slug}.${tld}`, "guess");
  return out.slice(0, max);
}
