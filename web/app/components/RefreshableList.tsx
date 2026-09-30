"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import PullToRefresh from "./PullToRefresh";

/**
 * Client boundary that lets a server-rendered list be pulled to refresh.
 * router.refresh() re-runs the server components in place; no full reload,
 * so the nav does not remount.
 */
export default function RefreshableList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const settleRef = useRef<(() => void) | null>(null);

  // A fixed 650ms sleep before retracting the spinner was a guess at how
  // long the server re-render takes; too short and the spinner snaps back
  // before the new data has actually landed. Running router.refresh() inside
  // a transition lets `isPending` tell us exactly when the refreshed RSC
  // payload has committed, instead of guessing at a duration. The timeout
  // is just a backstop so the spinner can never hang forever if a refresh
  // stalls for some other reason.
  useEffect(() => {
    if (!isPending && settleRef.current) {
      settleRef.current();
      settleRef.current = null;
    }
  }, [isPending]);

  return (
    <PullToRefresh
      className={className}
      onRefresh={() =>
        new Promise<void>((resolve) => {
          settleRef.current = resolve;
          startTransition(() => {
            router.refresh();
          });
          window.setTimeout(() => {
            if (settleRef.current === resolve) {
              settleRef.current = null;
              resolve();
            }
          }, 4000);
        })
      }
    >
      {children}
    </PullToRefresh>
  );
}
