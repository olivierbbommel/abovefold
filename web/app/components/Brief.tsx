import { Fragment } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Item } from "@/lib/types";
import type { MixEntry } from "@/lib/nav-queries";

/*
 * Today's right rail on desktop (spec 5.1): The brief, Today's mix, Also
 * covered. 300px, 24px inset, 32px between blocks. The brief is the screen's
 * one indigo region (spec 2.1 colour budget); the other two are neutral
 * text. The old "Clusters today" bar chart is gone: the count is the
 * information, and a bar next to it said the same thing less precisely.
 */

type Covered = { id: number; title: string; size: number };

// One entry per cluster, largest first, from the rows the page already has.
function alsoCovered(items: Item[]): Covered[] {
  const byCluster = new Map<number, Covered>();
  for (const item of items) {
    if (item.clusterId === null || item.clusterSize <= 1) continue;
    const existing = byCluster.get(item.clusterId);
    if (!existing || item.clusterSize > existing.size) {
      byCluster.set(item.clusterId, { id: item.id, title: item.title, size: item.clusterSize });
    }
  }
  return [...byCluster.values()].sort((a, b) => b.size - a.size).slice(0, 6);
}

export default function Brief({ lines, items, mix }: { lines: string[]; items: Item[]; mix: MixEntry[] }) {
  const covered = alsoCovered(items);

  return (
    <aside aria-label="About today" className="today-rail hidden w-[300px] shrink-0 flex-col gap-8 border-l border-hairline px-6 pb-10 pt-9 xl:flex">
      <section>
        <h2 className="flex items-center gap-1.5 t-eyebrow text-muted">
          <Sparkles className="h-3 w-3 text-ai" strokeWidth={2} aria-hidden="true" />
          The brief
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {lines.map((line, i) => (
            <p key={i} className="text-[0.875rem] leading-5 text-ink-2 text-pretty">
              {line}
            </p>
          ))}
        </div>
      </section>

      {mix.length > 0 && (
        <section className="border-t border-hairline pt-8">
          <h2 className="t-eyebrow text-muted">Today&rsquo;s mix</h2>
          <p className="mt-3 t-meta text-muted">
            {mix.map((m, i) => (
              <Fragment key={m.folderId}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">
                  {m.title} {m.count}
                </span>
              </Fragment>
            ))}
          </p>
        </section>
      )}

      {covered.length > 0 && (
        <section className="border-t border-hairline pt-8">
          <h2 className="t-eyebrow text-muted">Also covered</h2>
          <ul className="mt-2">
            {covered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/article/${c.id}`}
                  className="-mx-2 flex h-7 items-center gap-3 rounded-sm px-2 text-[0.8125rem] text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="t-caption text-faint tabular-nums" aria-label={`${c.size} sources`}>
                    {c.size}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
