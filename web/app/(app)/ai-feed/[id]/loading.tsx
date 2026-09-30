import { SkeletonRow } from "@/app/components/Skeleton";

/* An AI feed while it loads: dynamic name and query, then stories. */
export default function Loading() {
  return (
    <main className="flex-1 min-w-0 px-5 pb-[calc(50px+env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+8px)] lg:px-10 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-[720px]" aria-hidden="true">
        <div className="h-12 lg:hidden" />
        <div className="skeleton h-[1.875rem] w-48 rounded-sm lg:h-[2.125rem]" />
        <div className="skeleton mt-2.5 h-3 w-64" />
        <div className="mt-6 flex flex-col border-t border-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
