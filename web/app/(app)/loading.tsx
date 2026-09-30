import { SkeletonBrief, SkeletonLead, SkeletonRow } from "@/app/components/Skeleton";

/**
 * Next's Suspense fallback for "/" before page.tsx starts rendering (first
 * navigation, module load). Once the page renders, its own boundaries take
 * over with the same shapes, so this mirrors Today exactly. The layout (rail
 * and tab bar) stays mounted above it and never flashes.
 */
export default function Loading() {
  return (
    <div className="flex min-w-0 flex-1">
      <main className="page-main">
        <div className="page-column">
          <header className="pt-[calc(env(safe-area-inset-top)+16px)] lg:pt-8">
            <h1 className="t-display text-ink">Today</h1>
            <div className="skeleton mt-2.5 h-3 w-48" />
            <div className="mt-4 h-px bg-line lg:mt-5" />
          </header>
          <div className="pb-6">
            <SkeletonLead />
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
      </main>
      <SkeletonBrief />
    </div>
  );
}
