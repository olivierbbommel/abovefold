"use client";

import { Folder as FolderIcon, LoaderCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { tileLetter } from "@/lib/add-format";
import type { Folder } from "./types";

/*
 * Small pieces shared by the Add screen's cards, steps and catalog.
 */

/**
 * A site's tile. Sites not yet followed have no favicon we may fetch (a
 * third-party favicon service would leak what is being looked at), so the
 * tile is a letter on an inset. Never a broken image.
 */
export function LetterTile({ name, size = 40 }: { name: string; size?: 32 | 40 }) {
  return (
    <span
      aria-hidden="true"
      className={`add-tile flex shrink-0 items-center justify-center bg-surface-3 font-semibold text-muted ${
        size === 40 ? "h-10 w-10 rounded-md text-[1.0625rem]" : "h-8 w-8 rounded-sm text-[0.875rem]"
      }`}
    >
      {tileLetter(name)}
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <LoaderCircle
      className="spin shrink-0"
      style={{ width: size, height: size }}
      strokeWidth={2}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    />
  );
}

/**
 * "Goes in Tech · reads closest to your sources there", with Change. The
 * sparkles glyph only when the folder is the resolver's suggestion; a
 * folder the person chose (or arrived with) gets the plain folder glyph.
 */
export function FolderLine({
  folders,
  value,
  suggestedId,
  onChange,
}: {
  folders: Folder[];
  value: number | null;
  suggestedId: number | null;
  onChange: () => void;
}) {
  const folder = value === null ? null : folders.find((f) => f.id === value) ?? null;
  const suggested = folder !== null && folder.id === suggestedId;
  return (
    <div className="flex min-h-11 items-center gap-2">
      {suggested ? (
        <Sparkles className="h-3 w-3 shrink-0 text-ai" strokeWidth={2} aria-hidden="true" />
      ) : (
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden="true" />
      )}
      {folder ? (
        <>
          <span className="t-caption min-w-0 flex-1 truncate text-muted">
            Goes in <b className="font-semibold text-ink-2">{folder.title}</b>
            {suggested ? " · reads closest to your sources there" : null}
          </span>
          <TextButton onClick={onChange} tone="accent" aria-label={`Change folder, now ${folder.title}`}>
            Change
          </TextButton>
        </>
      ) : (
        <TextButton onClick={onChange} tone="accent">
          Choose a folder
        </TextButton>
      )}
    </div>
  );
}

export function TextButton({
  children,
  onClick,
  tone = "muted",
  className = "",
  ...rest
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "accent" | "muted";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`add-textbtn tap -mx-1.5 inline-flex shrink-0 items-center rounded-sm px-1.5 text-[0.8125rem] font-semibold lg:min-h-8 lg:text-[0.75rem] ${
        tone === "accent" ? "text-accent" : "font-medium text-muted hover:text-ink"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The one filled accent control on a card: 48 tall on the phone, 36 on desktop. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  className = "",
  desktopInline = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  /** Desktop: trailing-aligned and content-width rather than full width. */
  desktopInline?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`add-primary tap t-button flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-accent-ink hover:brightness-105 disabled:cursor-default lg:h-9 ${
        desktopInline ? "lg:ml-auto lg:w-auto lg:min-w-24" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}
