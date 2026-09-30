import { SkeletonRow } from "@/app/components/Skeleton";

/* Newsletters while it loads: the static title, three source rows, three issues. */
export default function Loading() {
  return (
    <main className="flex-1 min-w-0 px-5 pb-[calc(50px+env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+8px)] lg:px-10 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-[720px]">
        <header className="border-b border-line pb-4 pt-3 lg:pt-0">
          <h1 className="t-display text-ink">Newsletters</h1>
          <div className="skeleton mt-2.5 h-3 w-40" />
        </header>
        <div className="mt-1 flex flex-col">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 border-b border-hairline py-2.5">
              <div className="flex-1">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton mt-1.5 h-3 w-56" />
              </div>
              <div className="skeleton h-5 w-5 rounded-xs" />
            </div>
          ))}
        </div>
        <div className="skeleton mt-8 h-3 w-24" />
        <div className="flex flex-col">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
