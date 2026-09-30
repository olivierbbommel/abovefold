/**
 * Shared skeleton primitives for route `loading.tsx` fallbacks and in-page
 * Suspense boundaries. Every shape mirrors the component it stands in for
 * (spec 5.9: 72x72 thumb bone, three headline bones on the 23px line, one
 * meta bone), so nothing reflows when the real content swaps in. Compare
 * against StoryRow, Rail and Brief before changing either side.
 *
 * The shimmer is the shared `.skeleton` class in globals.css, a slow sweep
 * that is off under prefers-reduced-motion.
 */

function Bone({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Stands in for StoryRow variant="row". */
export function SkeletonRow() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-x-4 border-b border-hairline py-4 lg:grid-cols-[minmax(0,1fr)_96px] lg:py-[18px]">
      <div className="min-w-0">
        <Bone className="mt-[3px] h-[17px] w-full max-w-[520px]" />
        <Bone className="mt-1.5 h-[17px] w-11/12 max-w-[480px]" />
        <Bone className="mt-1.5 h-[17px] w-3/5 max-w-[300px]" />
        <div className="mt-3.5 flex items-center gap-1.5">
          <Bone className="h-4 w-4 shrink-0 rounded-xs" />
          <Bone className="h-3 w-24" />
        </div>
      </div>
      <Bone className="h-[72px] w-[72px] rounded-md lg:w-[96px]" />
    </div>
  );
}

/** Stands in for StoryRow variant="lead". */
export function SkeletonLead() {
  return (
    <div className="grid gap-4 border-b border-hairline py-5 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-7 lg:py-6">
      <Bone className="aspect-[16/9] w-full rounded-md lg:order-2 lg:aspect-[3/2]" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Bone className="h-4 w-4 shrink-0 rounded-xs" />
          <Bone className="h-3 w-24" />
        </div>
        <Bone className="mt-3 h-[24px] w-full max-w-[560px]" />
        <Bone className="mt-1.5 h-[24px] w-4/5 max-w-[440px]" />
        <Bone className="mt-3 h-3 w-3/5 max-w-[320px]" />
      </div>
    </div>
  );
}

/** Stands in for the desktop Rail. The phone tab bar needs no data and never waits. */
export function SkeletonRail() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col bg-surface-2 lg:flex" aria-hidden="true">
      <div className="px-[22px] pb-3 pt-5">
        <span className="font-serif text-[1.1875rem] font-semibold leading-6 text-ink">abovefold</span>
      </div>
      <div className="px-3 pb-3">
        <Bone className="h-8 rounded-sm" />
      </div>
      <div className="flex flex-col gap-0.5 px-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-8 items-center gap-2.5 px-2.5">
            <Bone className="h-[18px] w-[18px] rounded-xs" />
            <Bone className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="pb-1 pl-[22px] pt-7">
        <Bone className="h-3 w-16" />
      </div>
      <div className="flex flex-col gap-0.5 px-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-[30px] items-center pl-8">
            <Bone className="h-3 w-28" />
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Stands in for Brief, Today's right rail. */
export function SkeletonBrief() {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-8 border-l border-hairline px-6 pb-10 pt-9 xl:flex" aria-hidden="true">
      <div>
        <Bone className="h-3 w-20" />
        <div className="mt-3 flex flex-col gap-2">
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-4/5" />
        </div>
      </div>
      <div className="border-t border-hairline pt-8">
        <Bone className="h-3 w-24" />
        <Bone className="mt-3 h-3 w-full" />
      </div>
      <div className="border-t border-hairline pt-8">
        <Bone className="h-3 w-24" />
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className="h-3.5 w-full" />
          ))}
        </div>
      </div>
    </aside>
  );
}
