"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/*
 * An <img> that removes itself when it fails (spec 5.5: never a broken
 * image; 5.1: no reserved space when there is no image). Layouts that make
 * room for a picture key off the element being there, so a failed one takes
 * its space with it.
 */
export default function Img(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "onError">) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // An image that failed before hydration fired its error event before
  // React was listening.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- alt comes from the caller
  return <img ref={ref} {...props} onError={() => setFailed(true)} />;
}
