import type { ReactNode } from "react";
import { SkeletonRow } from "../Skeleton";

/* The page frame for the plain list pages (Later, Recently read, Library,
   Search): the content column, with the phone's tab bar and safe areas
   accounted for. Today adds its right rail around the same frame. */
export default function ListPage({ children }: { children: ReactNode }) {
  return (
    <main className="page-main">
      <div className="page-column">{children}</div>
    </main>
  );
}

/** A loading.tsx body: the real title, a subtitle bone, and rows. */
export function ListPageSkeleton({ title, rows = 7 }: { title: string; rows?: number }) {
  return (
    <ListPage>
      <header className="pt-[calc(env(safe-area-inset-top)+16px)] lg:pt-8">
        <h1 className="t-display text-ink">{title}</h1>
        <div className="skeleton mt-2.5 h-3 w-24" />
        <div className="mt-4 h-px bg-line lg:mt-5" />
      </header>
      <div className="pb-6">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </ListPage>
  );
}
