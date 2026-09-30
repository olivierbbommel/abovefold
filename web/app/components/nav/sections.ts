/*
 * Which top-level place a path belongs to. The tab bar and the rail both
 * answer "where am I" from this one function so they can never disagree.
 * Folder, feed, AI feed and newsletter pages live under Library on the phone
 * (spec 4.3); Recently read lives on the Search tab's landing page.
 */
export type Section = "today" | "later" | "library" | "search" | "recent" | "newsletters" | "other";

export function sectionOf(pathname: string): Section {
  if (pathname === "/" || pathname.startsWith("/today")) return "today";
  if (pathname.startsWith("/later")) return "later";
  if (pathname.startsWith("/recent")) return "recent";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/newsletters")) return "newsletters";
  if (
    pathname.startsWith("/library") ||
    pathname.startsWith("/folder") ||
    pathname.startsWith("/feed/") ||
    pathname.startsWith("/ai-feed/") ||
    pathname.startsWith("/add")
  ) {
    return "library";
  }
  return "other";
}

/** The phone tab a section is shown under. */
export function tabOf(section: Section): "today" | "later" | "library" | "search" | null {
  switch (section) {
    case "today":
    case "later":
    case "library":
    case "search":
      return section;
    case "recent":
      return "search";
    case "newsletters":
      return "library";
    default:
      return null;
  }
}
