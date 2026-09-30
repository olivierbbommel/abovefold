import Link from "next/link";
import { todayHref, type TodaySort } from "@/lib/url";

/*
 * Ranked | Newest (spec 5.1): a segmented control on surface-3 with the
 * active segment raised on surface. Links, not buttons, so the choice lives
 * in the URL and composes with ?folder=. "Newest" is also the off switch for
 * folder balance (spec 6.2); no other control for that exists.
 */
export default function SortControl({
  sort,
  folderId,
  size = "compact",
  onNavigate,
}: {
  sort: TodaySort;
  folderId: number | null;
  size?: "compact" | "large";
  onNavigate?: () => void;
}) {
  const seg = size === "large" ? "h-11 flex-1 t-chip" : "h-[22px] px-3 text-[0.75rem] leading-4";
  return (
    <div
      role="group"
      aria-label="Sort"
      className={`flex rounded-sm bg-surface-3 p-[3px] ${size === "large" ? "w-full" : ""}`}
    >
      {(["ranked", "newest"] as const).map((s) => {
        const on = s === sort;
        return (
          <Link
            key={s}
            href={todayHref({ sort: s, folderId })}
            onClick={onNavigate}
            aria-current={on ? "true" : undefined}
            className={`flex items-center justify-center whitespace-nowrap rounded-[4px] ${seg} ${
              on ? "bg-surface font-semibold text-ink shadow-e1" : "font-medium text-muted hover:text-ink"
            }`}
          >
            {s === "ranked" ? "Ranked" : "Newest"}
          </Link>
        );
      })}
    </div>
  );
}
