import ListPage from "@/app/components/nav/ListPage";

export default function Loading() {
  return (
    <ListPage>
      <header className="pt-[calc(env(safe-area-inset-top)+16px)] lg:pt-8">
        <h1 className="t-display text-ink">Library</h1>
        <div className="skeleton mt-2.5 h-3 w-32" />
        <div className="mt-4 h-px bg-line lg:mt-5" />
      </header>
      <div className="flex flex-col gap-7 pt-6">
        {[6, 1, 1].map((n, g) => (
          <div key={g}>
            <div className="skeleton mb-2 ml-1 h-3 w-20" />
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="flex h-[52px] items-center gap-3 border-b border-hairline px-4 last:border-b-0">
                  <div className="skeleton h-[18px] w-[18px] rounded-xs" />
                  <div className="skeleton h-3.5 w-32" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ListPage>
  );
}
