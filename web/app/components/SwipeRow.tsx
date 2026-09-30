"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type SwipeAction = {
  label: string;
  icon: ReactNode;
  /** Background of the revealed action pane, a CSS color, typically a token like "var(--accent)" or "var(--ok)". */
  color: string;
  onAction: () => Promise<void> | void;
  /**
   * After a successful action, spring back instead of staying off-screen.
   * Saving for later keeps the story in the list; only mark-read removes it.
   * Before this existed, swiping to save deleted the story from Today.
   */
  keepRow?: boolean;
};

type Props = {
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
  children: ReactNode;
  className?: string;
};

/** Fraction of the row's own width the drag must cross before release commits it. */
const COMMIT_RATIO = 0.27;
/** px of raw finger movement before we commit to a gesture direction. */
const DIRECTION_LOCK_PX = 8;
/**
 * Rubber band so the row never actually reaches the true edge of the
 * finger's travel. K=1 means no resistance at all near the start of the
 * drag (1:1 tracking), resistance only grows as the drag approaches DIM,
 * which is far beyond both the commit point and typical row widths. That
 * keeps the curve linear over the ~100px of real finger travel a commit
 * takes on a phone-width row, so a normal one-handed thumb swipe reaches
 * COMMIT_RATIO well before running out of screen.
 */
const RUBBER_DIM = 1000;
const RUBBER_K = 1;
/** Distance the icon+label take to reach full opacity/scale, independent of commit distance. */
const ICON_REVEAL_PX = 72;

function rubberBand(distance: number) {
  const sign = distance < 0 ? -1 : 1;
  const abs = Math.abs(distance);
  return (sign * abs * RUBBER_K * RUBBER_DIM) / (RUBBER_DIM + RUBBER_K * abs);
}

/**
 * Feedly-style swipe-to-act row. Wrap a single row's content:
 *
 *   <SwipeRow
 *     leftAction={{ label: "Read later", icon: <BookmarkIcon/>, color: "var(--accent)", onAction: async () => {} }}
 *     rightAction={{ label: "Mark read", icon: <CheckIcon/>, color: "var(--ok)", onAction: async () => {} }}
 *   >{children}</SwipeRow>
 *
 * Dragging right reveals leftAction behind the row, dragging left reveals
 * rightAction; release past COMMIT_RATIO of the row's width commits it (the
 * row slides fully away and onAction fires), anything short springs back.
 *
 * The gesture locks to the horizontal axis only once a touch clearly reads
 * as horizontal, an ambiguous or vertical touch is handed back to native
 * scrolling immediately and untouched, so a SwipeRow inside a scrolling
 * list never fights the list for the gesture.
 *
 * children always render normally regardless of platform: only touch
 * listeners are attached, so mouse and keyboard interaction with children
 * (e.g. a row's own buttons) is never intercepted. This is a pure add-on.
 */
export default function SwipeRow({ leftAction, rightAction, children, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  const dxRef = useRef(0);
  useEffect(() => {
    dxRef.current = dx;
  }, [dx]);

  const leftRef = useRef(leftAction);
  leftRef.current = leftAction;
  const rightRef = useRef(rightAction);
  rightRef.current = rightAction;

  const drag = useRef({
    tracking: false,
    startX: 0,
    startY: 0,
    direction: null as null | "horizontal" | "vertical",
    width: 1,
  });
  const busyRef = useRef(false);

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
    if (!coarsePointer) return;
    const wrap = wrapRef.current;
    if (!wrap) return;

    function onTouchStart(e: TouchEvent) {
      if (busyRef.current) return;
      if (e.touches.length > 1) return; // ignore multi-touch: don't let a second finger re-anchor the gesture
      const t = e.touches[0];
      drag.current = {
        tracking: true,
        startX: t.clientX,
        startY: t.clientY,
        direction: null,
        width: wrap!.offsetWidth || 1,
      };
      setDragging(true);
    }

    function onTouchMove(e: TouchEvent) {
      const d = drag.current;
      if (!d.tracking) return;
      const t = e.touches[0];
      const rawDx = t.clientX - d.startX;
      const rawDy = t.clientY - d.startY;

      if (d.direction === null) {
        if (Math.hypot(rawDx, rawDy) < DIRECTION_LOCK_PX) return;
        // Bias toward "vertical" on ambiguous angles, a list the user is
        // scrolling should never accidentally commit an action.
        d.direction = Math.abs(rawDx) > Math.abs(rawDy) * 1.1 ? "horizontal" : "vertical";
        if (d.direction === "vertical") {
          d.tracking = false; // hand this touch back to native scroll entirely
          setDragging(false);
          return;
        }
      }

      if (d.direction !== "horizontal") return;

      let clamped = rawDx;
      if (clamped > 0 && !leftRef.current) clamped = 0; // no left action: can't drag that way
      if (clamped < 0 && !rightRef.current) clamped = 0; // no right action: can't drag that way

      e.preventDefault(); // only once this is unambiguously our gesture
      setDx(rubberBand(clamped));
    }

    async function onTouchEnd() {
      const d = drag.current;
      if (!d.tracking) {
        setDragging(false);
        return;
      }
      d.tracking = false;
      setDragging(false);

      if (d.direction !== "horizontal") return; // became a scroll, nothing to settle

      const width = d.width || 1;
      const released = dxRef.current;
      const ratio = Math.abs(released) / width;
      const side: "left" | "right" | null = released > 0 ? "left" : released < 0 ? "right" : null;
      const action = side === "left" ? leftRef.current : side === "right" ? rightRef.current : undefined;

      if (side && action && ratio >= COMMIT_RATIO && !busyRef.current) {
        busyRef.current = true;
        setDx(side === "left" ? width : -width); // slide fully away, revealing the pane full-bleed
        try {
          await Promise.resolve(action.onAction());
          // Success: an action that keeps the row springs back (spec 3.2,
          // save). Otherwise stay off-screen: the caller collapses and removes
          // the row, and springing back would visually undo the action.
          if (action.keepRow) setDx(0);
        } catch (err) {
          // Failed: spring back, never leave the row in a committed state.
          setDx(0);
          console.error("SwipeRow action failed, reverting:", err);
        } finally {
          busyRef.current = false;
        }
      } else {
        setDx(0);
      }
    }

    function onTouchCancel() {
      // The system interrupted the touch (incoming call, edge swipe, long-press
      // menu), always reset, never commit. This must NOT share onTouchEnd's
      // commit branch: the user never released, so nothing was decided.
      drag.current.tracking = false;
      setDragging(false);
      setDx(0);
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

  const leftProgress = Math.min(Math.max(dx, 0) / ICON_REVEAL_PX, 1);
  const rightProgress = Math.min(Math.max(-dx, 0) / ICON_REVEAL_PX, 1);
  // Reduced motion means "don't animate", not "don't move", the row must still
  // reach its dragged/committed position, just without a transition on the way.
  const transition = dragging || reducedMotion ? "none" : "transform var(--spring-gentle-dur) var(--spring-gentle)";

  return (
    <div ref={wrapRef} data-swipe-row className={`relative overflow-hidden ${className}`}>
      {leftAction && (
        <div aria-hidden className="absolute inset-0 flex items-center pl-5" style={{ background: leftAction.color }}>
          <span
            className="flex items-center gap-2"
            style={{
              color: "var(--accent-ink)",
              opacity: reducedMotion ? 1 : leftProgress,
              transform: reducedMotion ? undefined : `scale(${0.85 + leftProgress * 0.15})`,
            }}
          >
            {leftAction.icon}
            <span className="t-chip">{leftAction.label}</span>
          </span>
        </div>
      )}
      {rightAction && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-end pr-5" style={{ background: rightAction.color }}>
          <span
            className="flex items-center gap-2"
            style={{
              color: "var(--accent-ink)",
              opacity: reducedMotion ? 1 : rightProgress,
              transform: reducedMotion ? undefined : `scale(${0.85 + rightProgress * 0.15})`,
            }}
          >
            <span className="t-chip">{rightAction.label}</span>
            {rightAction.icon}
          </span>
        </div>
      )}
      <div
        className="relative"
        style={{
          background: "var(--bg)",
          transform: `translateX(${dx}px)`,
          transition,
          willChange: dragging ? "transform" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
