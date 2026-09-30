// Inline, stroke-based icon set for the Today view. Kept as small components
// rather than a sprite sheet, no icon font, no emoji, ever.
//
// Also houses `timeAgo`, the display helper every row-shaped component
// needs, so the rows import it from here instead of duplicating it.

import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const defaultStroke = {
  fill: "none" as const,
  stroke: "currentColor",
};

/** The "abovefold" mark: a folded document. */
export function LogoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5h11a2 2 0 0 1 2 2v11a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M7.5 9h6" />
      <path d="M7.5 12.5h6" />
      <path d="M7.5 16h3.5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

/** Clock-in-a-circle, the Today nav item. */
export function TodayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinecap="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
    </svg>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinecap="round" {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m8 5 7 7-7 7" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z" />
    </svg>
  );
}

/** Two overlapping circles, the "N sources" badge on a clustered story. */
export function SourcesIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={2} {...props}>
      <circle cx="9" cy="9" r="5.5" />
      <circle cx="15" cy="15" r="5.5" />
    </svg>
  );
}

export function NewsletterIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 6.5h17v11h-17z" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function FiltersIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinecap="round" {...props}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  );
}

/** Three even bars, the mobile tab bar's "Menu" entry, opens the nav drawer. */
export function MenuIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  );
}

/** "Add content" / "New folder" affordances. */
export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.8} strokeLinecap="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Closes the mobile nav drawer. */
export function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.9} strokeLinecap="round" {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * The 4-point "sparkle", the ONLY marker used to flag AI-produced content
 * (a summary, the brief, a "why this is here" reason line). Never attach
 * this to anything the user did themselves.
 */
export function ReasonStar(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinejoin="round" {...props}>
      <path d="M12 3.5 13.9 9 19.5 10.9 13.9 12.8 12 18.5 10.1 12.8 4.5 10.9 10.1 9z" />
    </svg>
  );
}

/** Rename affordance, folder titles, source titles. */
export function PencilIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14.5 5.5 18.5 9.5 8 20 4 20 4 16z" />
      <path d="M12.5 7.5 16.5 11.5" />
    </svg>
  );
}

/** Delete/unsubscribe affordance. Always pair with --color-danger, never --color-accent. */
export function TrashIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultStroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 7h14" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M7 7l.8 12.1A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" />
      <path d="M10.3 11v6M13.7 11v6" />
    </svg>
  );
}

// --- shared display helpers -------------------------------------------------

/** Compact relative time ("5m", "2h", "3d") matching the design's rows. */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
