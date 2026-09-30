/*
 * Conservative allowlist sanitizer for newsletter HTML.
 *
 * Newsletter bodies are attacker-influenced: anyone who learns an inbound
 * address can mail arbitrary HTML to it. This runs before that HTML is
 * rendered on the instance's own origin, so a miss here is stored XSS against the
 * session cookie of the only account there is.
 *
 * Deliberately an allowlist, not a blocklist. Anything not named below is
 * dropped rather than escaped-and-kept, and every attribute must be named
 * too, which kills the whole `on*` family and the `srcdoc`/`formaction`
 * class of tricks without needing to enumerate them.
 */

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col",
  "colgroup", "dd", "div", "dl", "dt", "em", "figcaption", "figure", "h1",
  "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
  "q", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "u", "ul",
]);

/*
 * Tags whose *contents* go too, not just the tag itself. Only true
 * containers belong here. A void element listed here would never see its
 * closing tag and would swallow the rest of the document, caught in
 * testing, where a single <meta charset> erased an entire newsletter.
 */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "template", "noscript",
  "svg", "math", "select", "textarea", "title",
  // Raw-text and RCDATA elements. Nothing today reparses this sanitizer's
  // output, so these are not currently exploitable, but they are the exact
  // shape that becomes an mXSS sink the moment anything does.
  "xmp", "noembed", "noframes", "plaintext",
]);

/** Dangerous but void: drop the tag, keep going. */
const DROP_VOID = new Set([
  "meta", "link", "base", "input", "embed", "source", "track", "param",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
};

const SAFE_URL = /^(https?:|mailto:)/i;

/** Whitespace and C0 controls, which browsers ignore when resolving a scheme. */
const URL_NOISE = new RegExp("[\\u0000-\\u0020]", "g");

/*
 * Text between tags is ALREADY HTML: "&nbsp;" in a newsletter means a
 * non-breaking space. Escaping every "&" turned it into the literal text
 * "&nbsp;" (126 of them in one Gates Notes issue). Well-formed character
 * references pass through; a bare "&" is still escaped. Keeping them is safe
 * in text content: a reference there decodes to a character, never to markup.
 */
const ENTITY_REF = /&(?!(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g;

function escapeText(text: string): string {
  return text.replace(ENTITY_REF, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", colon: ":",
  tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")", period: ".",
};

/*
 * Attribute values are decoded BEFORE any check. The browser decodes
 * "javascript&#58;alert(1)" to "javascript:alert(1)" before it resolves the
 * URL, so a scheme test on the raw text is a test of the wrong string. (Until
 * this function existed, that attack was only blocked by accident: everything
 * was double-escaped, which is also what broke &nbsp;.) After the checks the
 * value is fully re-escaped, so what the browser decodes is exactly what was
 * checked.
 */
export function decodeEntities(value: string): string {
  return value.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

/* Attributes are decoded first (decodeEntities), so escape EVERY "&" here. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(raw: string): string | null {
  // Strip the noise first: a tab inside "java<TAB>script:alert(1)" resolves as
  // javascript: in a browser but would sail past a naive prefix test.
  const value = raw.replace(URL_NOISE, "");
  // Protocol-relative and path-relative URLs are fine; anything carrying an
  // explicit scheme must be one we named.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return SAFE_URL.test(value) ? value : null;
  }
  return value;
}

type Attr = { name: string; value: string };

function parseAttrs(raw: string): Attr[] {
  const attrs: Attr[] = [];
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    attrs.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? "",
    });
  }
  return attrs;
}

export type SanitizeOptions = {
  /*
   * Emit `data-src` instead of `src` on images, so nothing remote loads
   * until the reader asks. This is the mail-client model: a newsletter's
   * images are on the sender's hosts, often behind bot protection that
   * refuses our server (gatesnotes.com answers 403 to every proxied
   * fetch), and loading them unasked hands the sender a read receipt. On
   * "Load images" the browser fetches them directly, from the reader's own
   * IP, which is the only fetch those hosts accept anyway.
   */
  deferImages?: boolean;
  /*
   * Rewrite every surviving `img src`. Newsletter bodies are the only place
   * remote images arrive already embedded in markup rather than as a single
   * URL we chose, and rendering them as-is hands the sender a read receipt
   * plus the reader's IP and user-agent on every open. Passing the app's
   * image proxy here keeps images from being hotlinked for newsletters too.
   * Returning null drops the image entirely.
   */
  rewriteImageSrc?: (src: string) => string | null;
};

export function sanitizeHtml(input: string, options: SanitizeOptions = {}): string {
  const out: string[] = [];
  const openStack: string[] = [];
  // Non-null while inside a dropped subtree; counts nesting of that same tag
  // so a </div> inside a dropped <style> cannot close it early.
  let dropping: { tag: string; depth: number } | null = null;

  // Comments, declarations (<!DOCTYPE html>) and processing instructions
  // (<?xml ...?>) all match with no tag-name group and are dropped. Without
  // the middle two, a newsletter's DOCTYPE was rendered as literal text.
  const pattern = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    const text = input.slice(cursor, match.index);
    if (text && !dropping) out.push(escapeText(text));
    cursor = match.index + match[0].length;

    if (match[1] === undefined) continue; // comment

    const tag = match[1].toLowerCase();
    const isClose = match[0].startsWith("</");
    const selfClosing = (match[2] ?? "").trimEnd().endsWith("/");

    if (dropping) {
      if (tag !== dropping.tag) continue;
      if (isClose) {
        dropping.depth -= 1;
        if (dropping.depth === 0) dropping = null;
      } else if (!selfClosing) {
        dropping.depth += 1;
      }
      continue;
    }

    if (DROP_VOID.has(tag)) continue;

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!isClose && !selfClosing) dropping = { tag, depth: 1 };
      continue;
    }

    // Everything else unrecognised (html, head, body, form, button, font,
    // center, o:p from Outlook...) drops the tag but KEEPS its contents,
    // which is what preserves a newsletter wrapped in a full HTML document.

    if (!ALLOWED_TAGS.has(tag)) continue;

    if (isClose) {
      // Only emit a close for a tag we actually opened, so a stray </p>
      // cannot unbalance the document.
      const at = openStack.lastIndexOf(tag);
      if (at === -1) continue;
      while (openStack.length > at) out.push(`</${openStack.pop()}>`);
      continue;
    }

    const allowed = ALLOWED_ATTRS[tag];
    const kept: string[] = [];
    let imgSrc: string | null = null;
    let imgW = NaN;
    let imgH = NaN;
    if (allowed) {
      for (const attr of parseAttrs(match[2] ?? "")) {
        if (!allowed.has(attr.name)) continue;
        let value = decodeEntities(attr.value);
        if (attr.name === "href" || attr.name === "src") {
          const url = safeUrl(value);
          if (url === null) continue;
          value = url;
        }
        if (tag === "img") {
          if (attr.name === "width") imgW = Number(value);
          if (attr.name === "height") imgH = Number(value);
          if (attr.name === "src") {
            if (options.rewriteImageSrc) {
              const rewritten = options.rewriteImageSrc(value);
              if (rewritten === null) continue;
              value = rewritten;
            }
            imgSrc = value;
            if (options.deferImages) {
              kept.push(`data-src="${escapeAttr(value)}"`);
              continue;
            }
          }
        }
        kept.push(`${attr.name}="${escapeAttr(value)}"`);
      }
    }
    if (tag === "img") {
      // No usable source, or a tracking pixel. A 1x1 (or 2x2) image exists
      // only to report that the mail was opened; it is never content.
      if (imgSrc === null) continue;
      if (imgW <= 2 && imgH <= 2) continue;
    }

    const attrText = kept.length ? ` ${kept.join(" ")}` : "";
    if (VOID_TAGS.has(tag)) {
      out.push(`<${tag}${attrText} />`);
    } else if (selfClosing) {
      out.push(`<${tag}${attrText}></${tag}>`);
    } else {
      out.push(`<${tag}${attrText}>`);
      openStack.push(tag);
    }
  }

  const tail = input.slice(cursor);
  if (tail && !dropping) out.push(escapeText(tail));
  while (openStack.length) out.push(`</${openStack.pop()}>`);

  return out.join("");
}
