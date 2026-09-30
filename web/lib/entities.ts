/*
 * Decode HTML/XML character references in feed text (titles, headlines).
 *
 * One pass over the string, so "&amp;#039;" becomes the literal "&#039;"
 * rather than being decoded twice into an apostrophe. Numeric references
 * (decimal and hex) plus the named ones that actually turn up in feed
 * titles. An unknown name, or a code point outside Unicode, is left as
 * written rather than guessed at. Pure, no DOM, so it runs on the server.
 */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  sbquo: "‚", bdquo: "„", prime: "′", Prime: "″",
  ndash: "–", mdash: ", ", hellip: "…", bull: "•", middot: "·",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
  eacute: "é", egrave: "è", aacute: "á", agrave: "à", oacute: "ó",
  uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", ntilde: "ñ", szlig: "ß",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec, hex, name) => {
    if (name !== undefined) return NAMED[name] ?? m;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
  });
}
