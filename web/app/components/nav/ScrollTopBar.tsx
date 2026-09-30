"use client";

import { useEffect, useState } from "react";

/*
 * Phone scroll edge (spec 2.5). At rest there is no bar: the large page title
 * is the header. Once the page has scrolled 8px, the status bar strip turns
 * to glass so headlines scroll under it legibly; once the large title has
 * gone, a 44px glass bar with the page title in it takes over, the way an
 * iOS large title collapses. Transparent until then, and it never catches
 * taps while it is not visible.
 */
const EDGE = 8;
const TITLE_GONE = 56;

export default function ScrollTopBar({ title }: { title: string }) {
  const [state, setState] = useState<"rest" | "edge" | "bar">("rest");

  useEffect(() => {
    let frame = 0;
    function read() {
      frame = 0;
      const y = window.scrollY;
      setState(y > TITLE_GONE ? "bar" : y > EDGE ? "edge" : "rest");
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(read);
    }
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      data-state={state}
      className="scroll-topbar pointer-events-none fixed inset-x-0 top-0 z-20 lg:hidden"
    >
      <div className="scroll-topbar-title flex h-11 items-center justify-center px-16">
        <span className="truncate t-title text-ink">{title}</span>
      </div>
    </div>
  );
}
