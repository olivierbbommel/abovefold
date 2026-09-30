import { folders as minifluxFolders } from "@/lib/miniflux";
import AddPage from "@/app/components/add/AddPage";

// Always fresh: the folder list here should not go stale while the page is open.
export const dynamic = "force-dynamic";

export default async function AddSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const folders = await minifluxFolders();

  // A folder page's "Add a source" arrives as /add?category=<id> and
  // preselects that folder. Only an id that is one of this account's
  // folders counts; a stale one falls back to the suggested folder.
  const categoryId = category !== undefined ? Number(category) : NaN;
  const preselected = folders.find((f) => f.id === categoryId) ?? null;

  return (
    <main className="min-w-0 flex-1 px-5 pb-28 pt-6 sm:px-8 sm:pt-10 lg:px-10 lg:pb-10">
      <AddPage folders={folders.map((f) => ({ id: f.id, title: f.title }))} folderId={preselected?.id ?? null} />
    </main>
  );
}
