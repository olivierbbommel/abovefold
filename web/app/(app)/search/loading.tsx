import { SkeletonRow } from "@/app/components/Skeleton";
import ListPage from "@/app/components/nav/ListPage";

export default function Loading() {
  return (
    <ListPage>
      <header className="pt-[calc(env(safe-area-inset-top)+16px)] lg:pt-8">
        <h1 className="t-display text-ink">Search</h1>
      </header>
      <div className="mt-4">
        <div className="skeleton h-[52px] rounded-xl lg:h-12" />
        <div className="pt-6">
          <div className="skeleton h-3 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </ListPage>
  );
}
