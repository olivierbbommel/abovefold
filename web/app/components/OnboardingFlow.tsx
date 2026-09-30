"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { STARTER_PACKS } from "@/lib/starter-packs";
import { CheckIcon, FolderIcon, LogoIcon } from "./Icons";

export type ExistingFeed = { id: number; title: string; category: string };

type ImportOutcome = {
  label: string; // "your OPML file" | "starter packs"
  added: number;
  existing: number;
  failed: number;
  failedDetails: { title: string; error: string }[];
};

type Step = 1 | 2 | 3;

/**
 * Three-step first-run flow (see the "welcome" plan): bring your feeds,
 * decide on the 8 pre-seeded ones, done. Every step keeps a "Skip" escape
 * hatch, the product must never be gated on finishing this.
 */
export default function OnboardingFlow({ existingFeeds }: { existingFeeds: ExistingFeed[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [finishing, setFinishing] = useState(false);

  // --- Step 1: OPML + starter packs -----------------------------------------
  const [opmlFile, setOpmlFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importOutcomes, setImportOutcomes] = useState<ImportOutcome[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // --- Step 2: the pre-seeded feeds -----------------------------------------
  const [removeExisting, setRemoveExisting] = useState(false);

  function togglePack(id: string) {
    setSelectedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setOpmlFile(file);
  }

  async function finishOnboarding() {
    setFinishing(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          removeFeedIds: removeExisting ? existingFeeds.map((f) => f.id) : undefined,
        }),
      });
    } catch {
      // Best-effort, even if this fails, don't trap the user on /welcome.
    }
    router.push("/");
    router.refresh();
  }

  async function handleContinueFromStep1() {
    setImportError(null);
    const outcomes: ImportOutcome[] = [];

    if (opmlFile) {
      setImporting(true);
      try {
        const form = new FormData();
        form.append("file", opmlFile);
        const res = await fetch("/api/opml", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setImportError(data.error ?? "Couldn't read that OPML file.");
        } else {
          outcomes.push({
            label: "your OPML file",
            added: data.added,
            existing: data.existing,
            failed: data.failed,
            failedDetails: data.failedDetails ?? [],
          });
        }
      } catch {
        setImportError("Couldn't reach the server to import that file.");
      }
    }

    if (selectedPacks.size > 0) {
      try {
        const res = await fetch("/api/starter-packs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packIds: Array.from(selectedPacks) }),
        });
        const data = await res.json();
        if (res.ok) {
          outcomes.push({
            label: "your starter packs",
            added: data.added,
            existing: data.existing,
            failed: data.failed,
            failedDetails: data.failedDetails ?? [],
          });
        }
      } catch {
        // Non-fatal, the OPML outcome (if any) still gets shown.
      }
    }

    setImporting(false);
    setImportOutcomes(outcomes);
    setStep(2);
  }

  return (
    <div className="w-full max-w-[720px]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LogoIcon className="w-[18px] h-[18px] text-accent" />
          <span className="headline text-[17px] font-semibold text-ink">abovefold</span>
        </div>
        <button
          type="button"
          onClick={finishOnboarding}
          disabled={finishing}
          className="tap text-[13px] text-muted hover:text-ink-2 disabled:opacity-50"
        >
          Skip, I&apos;ll explore first
        </button>
      </div>

      <div className="bg-surface border border-line rounded-[14px] px-6 py-7 sm:px-9 sm:py-9">
        <p className="text-[11px] font-semibold tracking-[0.09em] uppercase text-faint mb-1.5">
          Step {step} of 3
        </p>

        {step === 1 && (
          <div>
            <h1 className="headline text-[24px] sm:text-[28px] font-medium tracking-[-0.3px] text-ink mb-1.5">
              Bring your feeds
            </h1>
            <p className="text-[13.5px] text-muted mb-6">
              Import what you already read, or start from a curated set.
            </p>

            <div className="grid md:grid-cols-[1.35fr_1fr] gap-4">
              {/* Primary path, OPML import */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`tap flex flex-col items-center justify-center text-center gap-3 rounded-[10px] border-2 border-dashed px-5 py-9 cursor-pointer transition-colors ${
                  dragActive ? "border-accent bg-accent/[0.06]" : "border-line bg-surface-2"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".opml,.xml,text/xml,text/x-opml"
                  className="hidden"
                  onChange={(e) => setOpmlFile(e.target.files?.[0] ?? null)}
                />
                <FolderIcon className="w-6 h-6 text-accent" />
                <div>
                  <p className="text-[14px] font-semibold text-ink">
                    {opmlFile ? opmlFile.name : "Drop your Feedly OPML file"}
                  </p>
                  <p className="text-[12.5px] text-muted mt-1">
                    {opmlFile ? "Click to choose a different file" : "or click to browse"}
                  </p>
                </div>
                <p className="text-[11.5px] text-faint">Feedly → Settings → OPML → Download</p>
              </div>

              {/* Secondary path, starter packs */}
              <div className="flex flex-col gap-1.5">
                {STARTER_PACKS.map((pack) => {
                  const selected = selectedPacks.has(pack.id);
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => togglePack(pack.id)}
                      className={`tap flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left transition-colors ${
                        selected ? "border-accent bg-accent/[0.06]" : "border-line hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-[16px] h-[16px] rounded-[4px] border flex items-center justify-center ${
                          selected ? "bg-accent border-accent" : "border-line"
                        }`}
                      >
                        {selected && <CheckIcon className="w-[11px] h-[11px] text-accent-ink" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium text-ink">{pack.name}</span>
                        <span className="block text-[11.5px] text-muted truncate">
                          {pack.feeds.length} feeds
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {importError && <p className="text-[12.5px] text-accent mt-4">{importError}</p>}

            <div className="flex items-center justify-end mt-7">
              <button
                type="button"
                onClick={handleContinueFromStep1}
                disabled={importing}
                className="tap h-10 px-5 rounded-[8px] bg-accent text-accent-ink text-[13.5px] font-medium disabled:opacity-60"
              >
                {importing ? "Importing…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="headline text-[24px] sm:text-[28px] font-medium tracking-[-0.3px] text-ink mb-1.5">
              Your starter feeds
            </h1>
            <p className="text-[13.5px] text-muted mb-5">
              abovefold came pre-loaded with these 8 feeds so there was something to rank on first
              launch. Keep them alongside what you just added, or clear them out.
            </p>

            {importOutcomes.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-5">
                {importOutcomes.map((outcome) => (
                  <ImportSummary key={outcome.label} outcome={outcome} />
                ))}
              </div>
            )}

            {existingFeeds.length === 0 ? (
              <p className="text-[12.5px] text-faint mb-6">
                Couldn&apos;t load the current feed list, so there is nothing to decide here. Moving on.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-px rounded-[10px] border border-line overflow-hidden mb-5">
                  {existingFeeds.map((feed) => (
                    <div
                      key={feed.id}
                      className="flex items-center justify-between gap-3 bg-surface-2 px-3.5 py-2.5"
                    >
                      <span className="text-[13px] text-ink-2 truncate">{feed.title}</span>
                      <span className="text-[11px] text-faint shrink-0">{feed.category}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRemoveExisting(false)}
                    className={`tap flex-1 h-10 rounded-[8px] text-[13px] font-medium border ${
                      !removeExisting
                        ? "bg-accent text-accent-ink border-accent"
                        : "border-line text-ink-2"
                    }`}
                  >
                    Keep them
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoveExisting(true)}
                    className={`tap flex-1 h-10 rounded-[8px] text-[13px] font-medium border ${
                      removeExisting
                        ? "bg-accent text-accent-ink border-accent"
                        : "border-line text-ink-2"
                    }`}
                  >
                    Remove them
                  </button>
                </div>
              </>
            )}

            <div className="flex items-center justify-between mt-7">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="tap h-10 px-4 rounded-[8px] text-[13.5px] text-ink-2 hover:bg-surface-2"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="tap h-10 px-5 rounded-[8px] bg-accent text-accent-ink text-[13.5px] font-medium"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="headline text-[24px] sm:text-[28px] font-medium tracking-[-0.3px] text-ink mb-1.5">
              You&apos;re set
            </h1>
            <p className="text-[13.5px] text-muted mb-8">
              New stories are fetched every 30 minutes and ranked for you.
            </p>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="tap h-10 px-4 rounded-[8px] text-[13.5px] text-ink-2 hover:bg-surface-2"
              >
                Back
              </button>
              <button
                type="button"
                onClick={finishOnboarding}
                disabled={finishing}
                className="tap h-10 px-5 rounded-[8px] bg-accent text-accent-ink text-[13.5px] font-medium disabled:opacity-60"
              >
                {finishing ? "One moment…" : "Go to Today"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Honest per-import result line, never claims success for feeds that failed. */
function ImportSummary({ outcome }: { outcome: ImportOutcome }) {
  const parts: string[] = [];
  if (outcome.added > 0) parts.push(`added ${outcome.added}`);
  if (outcome.existing > 0) parts.push(`${outcome.existing} already there`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);

  return (
    <div className="text-[12.5px] text-ink-2 bg-surface-2 rounded-[7px] px-3 py-2">
      <span className="font-medium">{outcome.label}:</span>{" "}
      {parts.length > 0 ? parts.join(", ") : "nothing to add"}
      {outcome.failedDetails.length > 0 && (
        <ul className="mt-1 text-faint text-[11.5px]">
          {outcome.failedDetails.map((f) => (
            <li key={f.title}>
              {f.title}: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
