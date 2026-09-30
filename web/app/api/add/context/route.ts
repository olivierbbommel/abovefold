import { NextResponse } from "next/server";
import { allFeeds, folders as minifluxFolders } from "@/lib/miniflux";

/*
 * What the Add sheet needs before anything is typed: the folders to file a
 * source into, and what is already followed (so a resolved feed can say
 * "You already follow The Verge, in Tech" instead of offering Follow).
 *
 * The sheet opens from any screen, so it cannot rely on the page having
 * loaded folders for it. Read-only; behind the session cookie like every
 * other API route.
 */
export const dynamic = "force-dynamic";

export type AddContext = {
  folders: { id: number; title: string }[];
  feeds: { id: number; title: string; categoryId: number; feedUrl: string; siteUrl: string }[];
};

export async function GET() {
  const [folders, feeds] = await Promise.all([minifluxFolders(), allFeeds()]);
  const body: AddContext = {
    folders: folders.map((f) => ({ id: f.id, title: f.title })),
    feeds: feeds.map((f) => ({
      id: f.id,
      title: f.title,
      categoryId: f.category.id,
      feedUrl: f.feed_url,
      siteUrl: f.site_url,
    })),
  };
  return NextResponse.json(body);
}
