import { SkeletonRow } from "@/app/components/Skeleton";

/* The folder page while it loads: dynamic title, source rows, then stories. */
export default function Loading() {
  return (
    <main className="flex-1 min-w-0 px-5 pb-[calc(50px+env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+8px)] lg:px-10 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-[720px]" aria-hidden="true">
        <div className="h-12 lg:hidden" />
        <div className="skeleton h-[1.875rem] w-40 rounded-sm lg:h-[2.125rem]" />
        <div className="skeleton mt-2.5 h-3 w-44" />

        <div className="mt-8 flex items-center justify-between border-b border-line pb-3">
          <div className="skeleton h-3 w-16" />
          <div className="skeleton h-3 w-24" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex min-h-16 items-center gap-3 border-b border-hairline py-2.5">
            <div className="skeleton h-6 w-6 shrink-0 rounded-sm" />
            <div className="flex-1">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton mt-1.5 h-3 w-40" />
            </div>
          </div>
        ))}

        <div className="mt-10 flex flex-col">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
