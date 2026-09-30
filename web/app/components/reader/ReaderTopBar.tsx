"use client";

import { useEffect, useState, type ReactNode } from "react";

/*
 * The reader's top bar (spec 5.3, 2.5). Transparent at rest; once the page
 * has scrolled 8px it turns to glass with a hairline on the content edge,
 * so the headline scrolling under it stays visible without competing with
 * the controls. Its own view-transition name keeps it out of the page
 * cross-fade (spec 3.2).
 */
export default function ReaderTopBar({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div data-scrolled={scrolled || undefined} className="reader-bar sticky top-0 z-20">
      <div className="flex h-11 items-center justify-between px-4 lg:h-12 lg:px-6">{children}</div>
    </div>
  );
}
