"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/*
 * The reader's leading control (spec 5.3): chevron plus the name of the tab
 * you came from ("Today", "Later"), one 44px target. Desktop always says
 * "Back".
 *
 * Where you came from is read off the URL during the reader's FIRST render.
 * On a client navigation that render happens before Next commits the new
 * URL, so `location.pathname` is still the list. It is remembered per
 * article (module state, plus sessionStorage for a reload). A direct load
 * renders "Today" on the server and on hydration, then corrects itself in an
 * effect, so hydration never mismatches.
 *
 * Back when there is history, Today otherwise (a shared link, a new tab,
 * the installed PWA opened straight onto an article).
 */

const LABELS: [RegExp, string][] = [
  [/^\/(today\/?)?$/, "Today"],
  [/^\/later/, "Later"],
  [/^\/(search|recent)/, "Search"],
  [/^\/newsletters/, "Newsletters"],
  [/^\/(folders|library|folder|feed|ai-feed|add)/, "Library"],
];

let captured: { id: number; label: string } | null = null;
const storageKey = (id: number) => `abovefold:reader-origin:${id}`;

function labelFor(path: string): string {
  for (const [re, label] of LABELS) if (re.test(path)) return label;
  return "Today";
}

/** The origin label if it is knowable synchronously, else null (direct load). */
export function captureOrigin(articleId: number): string | null {
  if (typeof window === "undefined") return null;
  if (captured?.id === articleId) return captured.label;
  const path = window.location.pathname;
  if (path === `/article/${articleId}`) return null;
  // From another article (the "Compare" link) the honest label is "Back".
  const label = path.startsWith("/article/") ? "Back" : labelFor(path);
  captured = { id: articleId, label };
  try {
    sessionStorage.setItem(storageKey(articleId), label);
  } catch {}
  return label;
}

function storedOrigin(articleId: number): string | null {
  try {
    return sessionStorage.getItem(storageKey(articleId));
  } catch {
    return null;
  }
}

/*
 * Back, with the title morphing back into its row (spec 3.2 "Back reverses
 * it"). Next applies a history traversal outside any view transition, so
 * React never starts one on the way back; this wraps router.back() in one
 * by hand. The title gets its `story-<id>` name for the old snapshot, the
 * list row already carries the same name, and the new snapshot is taken
 * once the reader has left the document (or after a second, whichever comes
 * first, so a slow restore can never freeze the screen). The system back
 * gesture is not wrapped and simply navigates.
 */
export function goBack(router: ReturnType<typeof useRouter>, articleId: number) {
  if (window.history.length <= 1) {
    router.push("/");
    return;
  }
  const title = document.querySelector<HTMLElement>("h1.reader-title");
  if (typeof document.startViewTransition !== "function" || !title) {
    router.back();
    return;
  }
  title.style.viewTransitionName = `story-${articleId}`;
  document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const started = performance.now();
        router.back();
        const poll = () => {
          if (!document.querySelector("h1.reader-title") || performance.now() - started > 1000) resolve();
          else setTimeout(poll, 16);
        };
        setTimeout(poll, 16);
      }),
  );
}

export default function ArticleBackButton({ articleId }: { articleId: number }) {
  const router = useRouter();
  const [label, setLabel] = useState(() => captureOrigin(articleId) ?? "Today");

  useEffect(() => {
    const stored = captured?.id === articleId ? captured.label : storedOrigin(articleId);
    if (stored) setLabel(stored);
  }, [articleId]);

  return (
    <button
      type="button"
      onClick={() => goBack(router, articleId)}
      aria-label={`Back to ${label === "Back" ? "the previous page" : label}`}
      className="tap reader-back -ml-2 flex h-11 min-w-11 shrink-0 items-center gap-0.5 rounded-sm pl-1 pr-2 text-ink-2 hover:bg-surface-2 lg:h-9 lg:pr-2.5"
    >
      <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="t-button font-medium lg:hidden">{label}</span>
      <span className="hidden t-button font-medium lg:inline">Back</span>
    </button>
  );
}
