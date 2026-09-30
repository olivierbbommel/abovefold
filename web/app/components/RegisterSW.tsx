"use client";

import { useEffect } from "react";

// Registers the PWA service worker on mount. Fails silently, a browser
// without SW support, or a registration error, should never surface to the
// user or break the page.
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent by design, offline support is a nice-to-have, not a
      // requirement for the app to function.
    });
  }, []);

  return null;
}
