import type { ResolveMatch, ResolveResponse } from "@/app/api/resolve/route";
import type { AddContext } from "@/app/api/add/context/route";
import type { ReadingSite } from "@/lib/reading-discovery";

export type { ResolveMatch, ResolveResponse, AddContext, ReadingSite };

export type Folder = AddContext["folders"][number];

/** One card under the Add box (spec 5.4 states 4 and 6 to 10). */
export type CardModel =
  | { t: "found"; key: string; match: ResolveMatch; linkedLine: string | null }
  | { t: "already"; key: string; name: string; feedId: number; folderTitle: string | null }
  | { t: "which"; key: string; matches: ResolveMatch[] }
  | { t: "none" | "blocked" | "unreachable"; key: string; host: string }
  | { t: "nothing"; key: string; query: string };

/*
 * The reading query looks back this far (lib/reading-discovery.ts
 * WINDOW_DAYS). Stated in the copy as it is, rather than as "this month".
 */
export const READING_WINDOW = "in the last 60 days";
