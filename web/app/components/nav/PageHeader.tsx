import type { ReactNode } from "react";
import ScrollTopBar from "./ScrollTopBar";

/*
 * The title block every top-level page shares (spec 5.1, 5.6, 5.8): a display
 * title, a meta subtitle, trailing controls on the title row, then a 1px line.
 * On the phone it sits below the safe area and collapses into ScrollTopBar
 * once scrolled away. Leaf pages (folder, source, Newsletters) pass `back`,
 * the phone's way out, which sits above the title and is hidden on desktop.
 */
export default function PageHeader({
  title,
  subtitle,
  trailing,
  back,
  icon,
  rule = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  back?: ReactNode;
  /** Before the title, e.g. a source's favicon on its page. */
  icon?: ReactNode;
  rule?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="page-header pt-[calc(env(safe-area-inset-top)+16px)] lg:pt-8">
      <ScrollTopBar title={title} />
      {back && <div className="-mt-2 lg:mt-0">{back}</div>}
      <div className="flex min-w-0 items-start justify-between gap-4 lg:items-end">
        <div className="min-w-0">
          {icon ? (
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              <h1 className="min-w-0 t-display text-ink">{title}</h1>
            </div>
          ) : (
            <h1 className="t-display text-ink">{title}</h1>
          )}
          {subtitle && <div className="mt-1.5 t-meta text-muted">{subtitle}</div>}
        </div>
        {trailing && <div className="-mr-2.5 flex shrink-0 items-center gap-1 lg:mr-0 lg:gap-2 lg:pb-0.5">{trailing}</div>}
      </div>
      {children}
      {rule && <div className="mt-4 h-px bg-line lg:mt-5" />}
    </header>
  );
}
