"use client";

import { useEffect, useRef } from "react";
import { noteRead } from "@/lib/read-ledger";

type Props = { articleId: number };

/**
 * Invisible reading-session tracker. On mount it fires an `opened`
 * interaction and asks Miniflux to mark the entry read. When the reader
 * leaves the page it reports how long they stayed, on unmount (client-side
 * navigation), on pagehide, and on tab-hide, whichever comes first.
 *
 * Every network call here is best-effort. A failed fetch or beacon must
 * never surface to the reader or block navigation.
 */
export default function DwellTracker({ articleId }: Props) {
  const openedAtRef = useRef<number>(0);
  const reportedRef = useRef(false);
  const interactionIdRef = useRef<number | null>(null);

  useEffect(() => {
    openedAtRef.current = Date.now();
    reportedRef.current = false;

    fetch("/api/interaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId, action: "opened" }),
      keepalive: true,
    })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.id === "number") interactionIdRef.current = d.id;
      })
      .catch(() => {});

    fetch("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId }),
      keepalive: true,
    })
      // Going Back restores the cached list, which still has this story;
      // the ledger lets that list drop it. See lib/read-ledger.ts.
      .then((r) => {
        if (!r.ok) return;
        // No router.refresh() here: it discarded the cached list, so Back
        // refetched Today and lost the scroll position. The ledger hides the
        // row at once; the lead story and counts catch up on the next refresh.
        noteRead(articleId);
      })
      .catch(() => {});

    function reportDwell() {
      // Deliberately NOT latched once. `reportedRef` used to be set on the
      // first pagehide/visibilitychange and never cleared, so backgrounding
      // the app at t=5s capped the recorded read at 5s no matter how long the
      // reader then stayed, and on mobile pagehide fires on backgrounding,
      // making that the common path, not a corner case. The read then fell
      // under the 20s bar and never counted toward personalisation.
      //
      // Re-reporting is safe: the update is `greatest(coalesce(dwell_ms,0),$1)`,
      // monotone and idempotent, so a later report only corrects it upward.
      // The latch still applies to the INSERT fallback below, which is not
      // idempotent and would create a duplicate row.
      const canUpdate = interactionIdRef.current !== null;
      if (!canUpdate && reportedRef.current) return;
      if (!canUpdate) reportedRef.current = true;

      const dwellMs = Date.now() - openedAtRef.current;
      // Update the row created on mount rather than inserting a second one.
      const payload = JSON.stringify(
        interactionIdRef.current
          ? { interactionId: interactionIdRef.current, articleId, dwellMs }
          : { articleId, action: "opened", dwellMs },
      );

      try {
        const blob = new Blob([payload], { type: "application/json" });
        const sent = navigator.sendBeacon?.("/api/interaction", blob);
        if (!sent) {
          // Beacon queue full or unsupported, fall back to a best-effort
          // fetch. It may not complete before unload, and that's fine.
          fetch("/api/interaction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Never let dwell reporting break navigation away from the page.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") reportDwell();
    }

    window.addEventListener("pagehide", reportDwell);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", reportDwell);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // THE important one. With client-side navigation (tapping Back to
      // Today) there is no page unload at all, so neither `pagehide` nor
      // `visibilitychange` ever fires, the component just unmounts and the
      // reading time was silently thrown away. Only tab-closes were being
      // recorded, which is why 14 of 21 reads had no dwell.
      reportDwell();
    };
  }, [articleId]);

  return null;
}
