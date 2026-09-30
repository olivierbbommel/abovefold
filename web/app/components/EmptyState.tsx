import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  title: string;
  body?: string;
  actionHref?: string;
  actionLabel?: string;
  /** An action that is not a link, e.g. a button that opens the Add sheet. */
  action?: ReactNode;
};

/*
 * Empty state (spec 5.9): glyph, title, one sentence, at most one action.
 * 96px from the top of the content area, never vertically centred: an empty
 * state in the middle of a phone reads as a page that failed to load.
 */
export default function EmptyState({ icon, title, body, actionHref, actionLabel, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 pb-16 pt-24 text-center">
      <span className="mb-1 text-faint [&_svg]:h-6 [&_svg]:w-6">{icon}</span>
      <p className="t-title text-ink-2">{title}</p>
      {body && <p className="max-w-[300px] t-body text-muted text-pretty">{body}</p>}
      {action ? (
        <div className="mt-3">{action}</div>
      ) : (
        actionHref &&
        actionLabel && (
          <Link
            href={actionHref}
            className="tap mt-3 inline-flex h-11 items-center rounded-md bg-accent px-5 t-button text-accent-ink hover:opacity-90"
          >
            {actionLabel}
          </Link>
        )
      )}
    </div>
  );
}
