"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { FolderLine, PrimaryButton, Spinner, TextButton } from "./parts";
import type { Folder } from "./types";

/*
 * Follow by email (spec 5.4 state 11). A private address per newsletter:
 * the site sends to it, the issue becomes a story. Same backend as the
 * Newsletters page (POST /api/newsletter-address).
 */

type Created = { email: string; label: string; feedCreated: boolean };

export default function FollowByEmailStep({
  name,
  onNameChange,
  folders,
  folderId,
  onChangeFolder,
  onDone,
  onAnother,
}: {
  name: string;
  onNameChange: (v: string) => void;
  folders: Folder[];
  folderId: number | null;
  onChangeFolder: () => void;
  onDone: () => void;
  onAnother: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/newsletter-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, categoryId: folderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.email !== "string") throw new Error();
      setCreated({ email: data.email, label: data.label, feedCreated: Boolean(data.feedCreated) });
      router.refresh();
    } catch {
      setError("Couldn't create the address. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copying failed. Select the address and copy it by hand.");
    }
  }

  return (
    <div className="pt-1">
      <h3 className="t-title text-ink">Follow by email</h3>
      <p className="t-body mt-1.5 text-ink-2">
        You get a private address. Sign up on their site with it, and every issue arrives here as a story.
      </p>

      {created ? (
        <div className="add-fade-in mt-5">
          <div className="add-address flex h-12 items-center gap-1 rounded-md bg-surface-3 pl-4 pr-1">
            <span className="add-address-text min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap text-[0.9375rem] tabular-nums text-ink">
              {created.email}
            </span>
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy address"}
              className="tap flex h-11 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[0.8125rem] font-semibold text-accent"
            >
              {copied ? (
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="t-body mt-4 text-ink-2">
            Sign up with this address. The first issue can take a day to arrive; you&apos;ll find it in Newsletters and in
            Today.
          </p>
          {!created.feedCreated ? (
            <p className="t-caption mt-2 text-muted">
              The address works, but its source could not be created automatically. It will appear once the first issue
              arrives.
            </p>
          ) : null}
          <p className="t-caption mt-4 flex items-center gap-2 text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full bg-faint" aria-hidden="true" />
            Waiting for the first issue
          </p>
          {error ? <p className="t-caption mt-2 text-muted">{error}</p> : null}
          <div className="mt-5 flex flex-col items-center gap-1 lg:flex-row-reverse lg:justify-start lg:gap-4">
            <PrimaryButton onClick={onDone} desktopInline>
              Done
            </PrimaryButton>
            <TextButton onClick={onAnother}>Add another</TextButton>
          </div>
        </div>
      ) : (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label htmlFor="add-email-name" className="t-caption text-muted">
            Name it
          </label>
          <input
            id="add-email-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
            maxLength={80}
            autoCapitalize="words"
            placeholder="Gates Notes"
            className="t-body mt-1.5 h-12 w-full rounded-md border border-line bg-surface px-4 text-ink outline-none placeholder:text-faint focus:border-accent lg:h-10"
          />
          <div className="mt-2">
            <FolderLine folders={folders} value={folderId} suggestedId={null} onChange={onChangeFolder} />
          </div>
          {error ? (
            <p className="t-caption mt-1 text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex border-t border-hairline pt-4">
            <PrimaryButton onClick={create} disabled={!name.trim()} busy={busy} desktopInline>
              {busy ? <Spinner label="Creating address" /> : "Create address"}
            </PrimaryButton>
          </div>
        </form>
      )}
    </div>
  );
}
