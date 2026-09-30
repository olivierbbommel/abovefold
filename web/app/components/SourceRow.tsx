import Link from "next/link";
import type { Folder, SourceStats } from "@/lib/types";
import { displayName } from "@/lib/display-name";
import { openedLabel, volumeLabel, type SourceActivity } from "@/lib/source-activity";
import { shortAgo } from "@/lib/reader-format";
import FeedIcon from "./FeedIcon";
import SourceActions from "./SourceActions";

/**
 * One source on a folder page (spec 5.6): favicon, display name, one caption
 * line ("~15 a day · last 1h"), and the ellipsis menu. The name opens the
 * source's own page.
 *
 * The open figure is only shown with at least ten stories behind it, and as
 * the raw pair ("opened 5 of 42") so the sample size is on screen (audit
 * A19). The old percentage read 100% for every source because it divided
 * opens by opens plus skips, and skips are almost never recorded.
 */
export default function SourceRow({
  feedId,
  title,
  categoryId,
  folders,
  stats,
  activity,
  problem = null,
}: {
  feedId: number;
  title: string;
  categoryId: number;
  folders: Folder[];
  stats: SourceStats;
  activity?: SourceActivity;
  problem?: string | null;
}) {
  const name = displayName(title) || title;
  const parts = [volumeLabel(stats.volumePerDay)];
  parts.push(stats.lastPost ? `last ${shortAgo(stats.lastPost)}` : "no posts yet");
  const opened = openedLabel(activity);
  if (opened) parts.push(opened);

  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-hairline">
      {/* The link fills the row's height, so the whole 64px band is the target. */}
      <Link href={`/feed/${feedId}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 self-stretch rounded-sm py-2.5">
        <FeedIcon feedId={feedId} title={title} size={24} radius={6} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold leading-5 text-ink" title={title}>
            {name}
          </span>
          {problem ? (
            <span className="mt-0.5 block truncate t-caption text-danger" title={problem}>
              {problem}
            </span>
          ) : (
            <span className="mt-0.5 block truncate t-caption text-faint tabular-nums">{parts.join(" · ")}</span>
          )}
        </span>
      </Link>
      <SourceActions feedId={feedId} feedTitle={title} displayTitle={name} categoryId={categoryId} folders={folders} />
    </div>
  );
}
