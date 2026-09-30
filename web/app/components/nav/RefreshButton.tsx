"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/* Desktop refresh (spec 5.1). Re-runs the server components in place; new
   rows then enter through EnterOnRefresh. Spins while the refresh is in
   flight, so a slow server is visible rather than a dead button. */
export default function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      aria-label="Refresh"
      title="Refresh (r)"
      className="tap flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
    >
      <RefreshCw className={`h-[18px] w-[18px] ${pending ? "spin" : ""}`} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
