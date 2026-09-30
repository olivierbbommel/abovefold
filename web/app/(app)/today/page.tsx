import { redirect } from "next/navigation";
import { todayHref } from "@/lib/url";

/*
 * There is one Today, at "/" (spec 5.1, audit A6). This route used to be a
 * second page with the full list, titled "Today · all stories". Old links and
 * bookmarks land on the real one with their sort and folder intact.
 */
export default async function TodayRedirect({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; folder?: string }>;
}) {
  const { sort, folder } = await searchParams;
  redirect(
    todayHref({
      sort: sort === "newest" ? "newest" : "ranked",
      folderId: folder && /^\d+$/.test(folder) ? Number(folder) : null,
    })
  );
}
