import { SkeletonRow } from "@/app/components/Skeleton";

/* A source page while it loads: favicon and dynamic title, one line of facts, stories. */
export default function Loading() {
  return (
    <main className="flex-1 min-w-0 px-5 pb-[calc(50px+env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+8px)] lg:px-10 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-[720px]" aria-hidden="true">
        <div className="h-12 lg:hidden" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-7 w-7 shrink-0 rounded-sm" />
          <div className="skeleton h-[1.875rem] w-44 rounded-sm lg:h-[2.125rem]" />
        </div>
        <div className="skeleton mt-2.5 h-3 w-56" />
        <div className="mt-6 flex flex-col border-t border-line">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
