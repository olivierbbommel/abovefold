"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import SwipeRow from "./SwipeRow";
import RowMenu from "./reader/RowMenu";
import { useToast } from "./Toast";
import { shortDate } from "@/lib/reader-format";

/*
 * The addresses on the Newsletters page (spec 5.7). One 64px row each: the
 * name, the address with a Copy button at the trailing end, and a caption
 * saying what has arrived.
 *
 * Copy is the common action, so it is the only one on the row. Remove is
 * destructive (the address stops accepting mail and its issues are deleted,
 * with no undo), so it no longer sits beside Copy at equal weight (audit
 * A17): it is a swipe to the left on the phone and an ellipsis menu on
 * desktop, and both end in an action sheet that says what is lost.
 *
 * Under a row, when present, the latest mail from the sender that is not an
 * issue (a verification link, a welcome) with Open and Dismiss, because
 * that link is exactly what is needed right after signing up.
 */

type Address = {
  token: string;
  label: string;
  email: string;
  messageCount: number;
  lastReceivedAt: string | null;
  pendingAdmin: { id: number; subject: string; receivedAt: string } | null;
};

function receivedLabel(address: Address): string {
  if (address.messageCount === 0) return "By email · nothing received yet";
  const issues = `${address.messageCount} ${address.messageCount === 1 ? "issue" : "issues"}`;
  if (!address.lastReceivedAt) return `By email · ${issues}`;
  const when = shortDate(address.lastReceivedAt);
  return `By email · ${issues} · last ${when}`;
}

export default function NewsletterAddressList({ addresses }: { addresses: Address[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy(address: Address) {
    try {
      await navigator.clipboard.writeText(address.email);
      setCopied(address.token);
      setTimeout(() => setCopied((current) => (current === address.token ? null : current)), 2000);
    } catch {
      push({ message: "Couldn't copy. Select the address and copy it by hand." });
    }
  }

  async function dismiss(address: Address) {
    if (!address.pendingAdmin) return;
    const response = await fetch(
      `/api/newsletter-message?token=${encodeURIComponent(address.token)}&id=${address.pendingAdmin.id}`,
      { method: "DELETE" },
    ).catch(() => null);
    if (!response?.ok) {
      push({ message: "Couldn't dismiss that email. Try again." });
      return;
    }
    router.refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/newsletter-address?token=${encodeURIComponent(pendingDelete.token)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        push({ message: "Couldn't remove that address. Try again." });
        return;
      }
      push({ message: `Removed ${pendingDelete.label}` });
      setPendingDelete(null);
      router.refresh();
    } catch {
      push({ message: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="flex flex-col">
        {addresses.map((address) => {
          const isCopied = copied === address.token;
          return (
            <li key={address.token} className="border-b border-hairline">
              <SwipeRow
                rightAction={{
                  label: "Remove",
                  icon: <Trash2 className="h-[22px] w-[22px]" strokeWidth={1.75} />,
                  color: "var(--danger)",
                  keepRow: true,
                  onAction: () => setPendingDelete(address),
                }}
              >
                <div className="flex min-h-16 items-center gap-2 bg-bg py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9375rem] font-semibold leading-5 text-ink">{address.label}</div>
                    <div className="truncate t-meta text-muted" title={address.email}>
                      {address.email}
                    </div>
                    <div className="mt-0.5 truncate t-caption text-faint tabular-nums">{receivedLabel(address)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(address)}
                    aria-label={isCopied ? "Copied" : `Copy the address for ${address.label}`}
                    className={`tap flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-surface-2 lg:h-9 lg:w-9 ${isCopied ? "text-ok" : "text-accent"}`}
                  >
                    {isCopied ? (
                      <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>
                  <div className="hidden lg:block">
                    <RowMenu
                      label={`Options for ${address.label}`}
                      items={[
                        {
                          label: "Remove",
                          icon: <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />,
                          onSelect: () => setPendingDelete(address),
                          danger: true,
                        },
                      ]}
                    />
                  </div>
                  {/* The swipe pane is invisible to assistive tech; this is its twin. */}
                  <button type="button" className="sr-only lg:hidden" onClick={() => setPendingDelete(address)}>
                    Remove {address.label}
                  </button>
                </div>
              </SwipeRow>

              {address.pendingAdmin && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-surface-3 py-1 pl-3 pr-1">
                  <div className="min-w-0 flex-1">
                    <div className="t-caption text-muted">From the sender</div>
                    <div className="truncate t-meta text-ink-2" title={address.pendingAdmin.subject}>
                      {address.pendingAdmin.subject}
                    </div>
                  </div>
                  <a
                    href={`/newsletter/${encodeURIComponent(address.token)}/${address.pendingAdmin.id}`}
                    className="tap flex h-11 shrink-0 items-center rounded-sm px-2.5 t-meta font-semibold text-accent lg:h-8"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => dismiss(address)}
                    className="tap flex h-11 shrink-0 items-center rounded-sm px-2.5 t-meta text-muted hover:text-ink lg:h-8"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <span className="sr-only" role="status">
        {copied ? "Address copied" : ""}
      </span>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Remove ${pendingDelete.email}?` : ""}
        message="Issues already received are deleted too. This can't be undone."
        confirmLabel="Remove address"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
