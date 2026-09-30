// Tiny pure helper, no server-only imports, no "use client", so both the
// server-rendered sort toggle (app/(app)/page.tsx) and the client-side
// folder filter menu (app/components/FilterMenu.tsx) build the exact same
// href shape and never clobber each other's query param.

export type TodaySort = "ranked" | "newest";

/**
 * Builds a href for the Today view ("/") that composes `sort` and `folder`
 * query params. Either can be set independently, passing `folderId` keeps
 * whatever `sort` the caller gives it, and vice versa. Defaults (ranked
 * sort, no folder) are omitted from the URL so the "clean" state stays "/".
 */
export function todayHref({
  sort = "ranked",
  folderId = null,
}: {
  sort?: TodaySort;
  folderId?: number | null;
}): string {
  const params = new URLSearchParams();
  if (sort === "newest") params.set("sort", "newest");
  if (folderId != null) params.set("folder", String(folderId));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
