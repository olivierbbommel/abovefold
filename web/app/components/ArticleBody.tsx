type Props = { text: string; title: string };

/**
 * The extracted article text in the reader type (spec 5.3): Newsreader
 * 18/29 on a phone, 19/30 on desktop, paragraphs 20 apart, at most 640 wide
 * (the column sets the measure).
 *
 * The extractor (trafilatura) separates paragraphs with blank lines and
 * keeps markdown heading markers. Everything renders as plain text, which
 * React escapes, so nothing in here is parsed as markup. Two repairs:
 *
 * - A leading "# Title" that repeats the article title is dropped (audit
 *   A20). It rendered as a body paragraph right under the real title.
 * - Any other "## Heading" paragraph renders as a subheading without its
 *   hashes, instead of showing the hashes as text.
 */

type Block = { kind: "p" | "h"; text: string };

const HEADING = /^#{1,6}\s+(.+)$/;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when `candidate` is the title again, allowing for truncation ("Apple Sports App Updated..."). */
function repeatsTitle(candidate: string, title: string): boolean {
  const a = normalise(candidate);
  const b = normalise(title);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 20 && short.length >= long.length * 0.6 && long.startsWith(short);
}

export function toBlocks(text: string, title: string): Block[] {
  const raw = text.split(/\n{2,}/);
  const blocks: Block[] = [];
  for (const chunk of raw) {
    // A heading line can sit directly on top of its paragraph with a single
    // newline between them; split it off so the paragraph survives.
    const lines = chunk.split("\n");
    const first = lines[0]?.trim() ?? "";
    const heading = HEADING.exec(first);
    if (heading && first.length <= 200) {
      blocks.push({ kind: "h", text: heading[1].replace(/#+\s*$/, "").trim() });
      const rest = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
      if (rest) blocks.push({ kind: "p", text: rest });
      continue;
    }
    const p = chunk.replace(/\s+/g, " ").trim();
    if (p) blocks.push({ kind: "p", text: p });
  }
  // Only the very first block can be the leaked title, heading or not.
  if (blocks.length > 0 && repeatsTitle(blocks[0].text, title) && blocks[0].text.length <= 300) {
    blocks.shift();
  }
  return blocks;
}

export default function ArticleBody({ text, title }: Props) {
  const blocks = toBlocks(text, title);

  if (blocks.length === 0) {
    return <p className="mt-8 t-body text-muted">No extracted text is available for this article.</p>;
  }

  return (
    <div className="reader-body mt-8 flex flex-col gap-5 t-reader text-ink">
      {blocks.map((block, i) =>
        block.kind === "h" ? (
          <h2 key={i} className="reader-subhead mt-3 text-ink">
            {block.text}
          </h2>
        ) : (
          <p key={i}>{block.text}</p>
        ),
      )}
    </div>
  );
}
