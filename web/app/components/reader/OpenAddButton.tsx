"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useAddSheet } from "@/app/components/add/AddSheetProvider";

/*
 * Opens the one Add sheet (spec 5.4) from a server-rendered page: "Add a
 * source" on a folder page (folder preselected), "Add newsletter" (a feed
 * or an address, marked as a newsletter) and "Create an address" (email
 * step) on Newsletters.
 */
/*
 * The provider is mounted in the (app) layout. Should a page ever render
 * without it, fall back to the /add page rather than throwing the page away.
 */
function useOpenAdd(): (o: { folderId?: number; step?: "email"; asNewsletter?: boolean }) => void {
  let ctx: ReturnType<typeof useAddSheet> | null = null;
  try {
    ctx = useAddSheet();
  } catch {
    ctx = null;
  }
  const router = useRouter();
  if (ctx) return ctx.openAdd;
  return (o) => router.push(o.folderId ? `/add?category=${o.folderId}` : "/add");
}

export default function OpenAddButton({
  label,
  folderId,
  step,
  asNewsletter,
  variant = "text",
}: {
  label: string;
  folderId?: number;
  step?: "email";
  asNewsletter?: boolean;
  variant?: "text" | "secondary" | "primary" | "icon";
}) {
  const openAdd = useOpenAdd();
  const onClick = () =>
    openAdd({ ...(folderId ? { folderId } : {}), ...(step ? { step } : {}), ...(asNewsletter ? { asNewsletter } : {}) });

  // The plus in a page header's title row, the same control as AddButton;
  // the label becomes its accessible name and tooltip.
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="tap flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink lg:h-8 lg:w-8"
      >
        <Plus className="h-[22px] w-[22px] lg:h-[18px] lg:w-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }

  const styles = {
    text: "-mr-2 h-11 gap-1.5 rounded-sm px-2 t-meta font-semibold text-accent hover:bg-surface-2 lg:h-8",
    secondary: "h-11 gap-1.5 rounded-md bg-surface-3 px-3.5 t-button text-ink-2 hover:bg-surface-2 lg:h-9",
    primary: "h-11 gap-1.5 rounded-md bg-accent px-5 t-button text-accent-ink hover:opacity-90",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap inline-flex shrink-0 items-center ${styles}`}
    >
      {variant !== "primary" && <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}
      {label}
    </button>
  );
}
