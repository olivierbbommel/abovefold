"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, LoaderCircle } from "lucide-react";

type Props = {
  /** Called once per completed pull. Awaited before the indicator settles back. */
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
};

type Phase = "idle" | "pulling" | "ready" | "refreshing";

/** Resisted pull (px) that counts as "armed"; release past this and it fires. */
const THRESHOLD = 70;
/** Where content rests while refreshing (spec 3.2). */
const SETTLE = 56;
/** Hard cap on how far the indicator is allowed to travel, however hard you pull. */
const MAX_PULL = 110;
/** px of raw finger movement before we commit to a gesture direction. */
const DIRECTION_LOCK_PX = 8;
/** iOS-style rubber band: asymptotically approaches DIM, never truly stops. */
const RUBBER_DIM = 130;
const RUBBER_K = 0.55;

function rubberBand(distance: number) {
  if (distance <= 0) return 0;
  return (distance * RUBBER_K * RUBBER_DIM) / (RUBBER_DIM + RUBBER_K * distance);
}

/**
 * Finds the nearest scrollable ancestor (an element with real overflow, or
 * failing that document.scrollingElement) so "at the top" means what the
 * user actually sees, not just some assumption about page layout.
 */
function getScrollParent(node: HTMLElement | null): Element {
  let el = node?.parentElement ?? null;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Feedly-style pull-to-refresh. Wrap the scrollable region of a page:
 *
 *   <PullToRefresh onRefresh={async () => { ... }}>{children}</PullToRefresh>
 *
 * Only ever activates when the nearest scrollable ancestor is already at
 * scrollTop 0 *and* the gesture reads as vertical; everything else (a
 * normal downward scroll, a horizontal swipe passing through) is left
 * completely alone so the page scrolls exactly as it would without this
 * component in the tree. Touch-only: on a mouse/trackpad device (pointer:
 * fine) no listeners are even attached.
 */
export default function PullToRefresh({ onRefresh, children, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const phaseRef = useRef<Phase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const drag = useRef({
    tracking: false,
    startX: 0,
    startY: 0,
    direction: null as null | "pull" | "other",
    scrollParent: null as Element | null,
  });
  const busyRef = useRef(false);
  const settlingRef = useRef(false);

  // Feature-detect once on mount, then keep listening for changes (a user
  // can plug in a mouse, or toggle reduced motion, mid-session).
  useEffect(() => {
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqPointer = window.matchMedia("(pointer: coarse)");
    const syncMotion = () => setReducedMotion(mqMotion.matches);
    const syncPointer = () => setCoarsePointer(mqPointer.matches);
    syncMotion();
    syncPointer();
    mqMotion.addEventListener("change", syncMotion);
    mqPointer.addEventListener("change", syncPointer);
    return () => {
      mqMotion.removeEventListener("change", syncMotion);
      mqPointer.removeEventListener("change", syncPointer);
    };
  }, []);

  useEffect(() => {
    if (!coarsePointer) return; // desktop/mouse: inert, no listeners at all
    const wrap = wrapRef.current;
    if (!wrap) return;

    function onTouchStart(e: TouchEvent) {
      if (busyRef.current || settlingRef.current) return;
      if (e.touches.length > 1) return; // ignore multi-touch: don't let a second finger re-anchor the gesture
      const t = e.touches[0];
      drag.current = {
        tracking: true,
        startX: t.clientX,
        startY: t.clientY,
        direction: null,
        scrollParent: getScrollParent(wrap),
      };
      setDragging(true);
    }

    function onTouchMove(e: TouchEvent) {
      const d = drag.current;
      if (!d.tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;

      if (d.direction === null) {
        if (Math.hypot(dx, dy) < DIRECTION_LOCK_PX) return;
        const scrollTop = (d.scrollParent as Element)?.scrollTop ?? 0;
        // Require a clearly-vertical, clearly-downward gesture starting at
        // the top before we ever touch preventDefault; anything ambiguous
        // (diagonal, horizontal, or not-at-top) is left to the browser.
        d.direction = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && scrollTop <= 0 ? "pull" : "other";
      }

      if (d.direction !== "pull") return;

      // The page may have scrolled a hair between touchstart and lock (e.g.
      // momentum from a prior scroll); bail out cleanly if so.
      if (((d.scrollParent as Element)?.scrollTop ?? 0) > 0) {
        d.tracking = false;
        setDragging(false);
        setPull(0);
        setPhase("idle");
        return;
      }

      e.preventDefault(); // only reached once we're sure this is our gesture
      const resisted = Math.min(rubberBand(dy), MAX_PULL);
      setPull(resisted);
      setPhase(resisted >= THRESHOLD ? "ready" : "pulling");
    }

    async function onTouchEnd() {
      const d = drag.current;
      if (!d.tracking) {
        setDragging(false);
        return;
      }
      d.tracking = false;
      setDragging(false);

      if (d.direction !== "pull") return; // never became our gesture; nothing to settle

      if (phaseRef.current === "ready" && !busyRef.current) {
        busyRef.current = true;
        setPhase("refreshing");
        setPull(SETTLE);
        try {
          await Promise.resolve(onRefreshRef.current());
        } finally {
          busyRef.current = false;
          settlingRef.current = true;
          setPhase("idle");
          setPull(0);
          window.setTimeout(() => {
            settlingRef.current = false;
          }, 260);
        }
      } else {
        setPhase("idle");
        setPull(0);
      }
    }

    function onTouchCancel() {
      // The system interrupted the touch (incoming call, edge swipe, long-press
      // menu); always reset, never fire the refresh. This must NOT share
      // onTouchEnd's commit branch: the user never released, so nothing fired.
      drag.current.tracking = false;
      setDragging(false);
      setPhase("idle");
      setPull(0);
    }

    wrap.addEventListener("touchstart", onTouchStart, { passive: true });
    wrap.addEventListener("touchmove", onTouchMove, { passive: false });
    wrap.addEventListener("touchend", onTouchEnd, { passive: true });
    wrap.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      wrap.removeEventListener("touchstart", onTouchStart);
      wrap.removeEventListener("touchmove", onTouchMove);
      wrap.removeEventListener("touchend", onTouchEnd);
      wrap.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [coarsePointer]);

  const progress = Math.min(pull / THRESHOLD, 1);
  const armed = phase === "ready" || phase === "refreshing";
  const showIndicator = pull > 0 || phase === "refreshing";
  // Spec 3.2: settle to 56px on the gentle spring, return over --dur-base.
  // Reduced motion means "don't animate", not "don't move": the indicator
  // and content still reach their positions, without a transition.
  const transitionStyle =
    dragging || reducedMotion
      ? "none"
      : phase === "refreshing"
        ? "transform var(--spring-gentle-dur) var(--spring-gentle)"
        : "transform var(--dur-base) var(--ease-standard)";

  const statusText = phase === "refreshing" ? "Refreshing" : phase === "ready" ? "Release to refresh" : phase === "pulling" ? "Pull to refresh" : "";

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{
          opacity: showIndicator ? 1 : 0,
          transform: `translateY(${pull - 48}px)`,
          transition: dragging ? "opacity 120ms linear" : `opacity 160ms linear, ${transitionStyle}`,
        }}
      >
        <span
          className={`mt-2 flex h-9 items-center justify-center rounded-full border border-hairline bg-surface text-muted shadow-e2 ${
            reducedMotion && phase === "refreshing" ? "px-3" : "w-9"
          }`}
        >
          {phase === "refreshing" ? (
            reducedMotion ? (
              <span className="t-caption">Refreshing</span>
            ) : (
              <LoaderCircle className="spin h-4 w-4" strokeWidth={2} />
            )
          ) : (
            <ArrowDown
              className="h-4 w-4"
              strokeWidth={2}
              style={{
                transform: `rotate(${armed ? 180 : progress * 180}deg)`,
                transition: dragging || reducedMotion ? "none" : "transform var(--dur-quick) var(--ease-standard)",
              }}
            />
          )}
        </span>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {/* This wrapper is a FLEX ITEM when the page passes a flex className
          (every list page does). Unstyled, it sized to its content and could
          not shrink, so the widest thing inside (the Today header controls)
          stretched <main> to 520px inside a 390px screen and clipped every
          headline and image on the right. flex-1 + min-w-0 lets it shrink. */}
      <div
        className="flex-1 min-w-0 flex flex-col"
        style={{
          // No transform at rest: any transform makes this wrapper the
          // containing block for position: fixed descendants (the phone's
          // scroll-edge bar), pinning them to the list instead of the screen.
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: transitionStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
