import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/*
 * The way out of a leaf page on the phone (folder, source, AI feed). An
 * installed PWA has no browser back gesture, so the page carries its own.
 * Desktop has the rail and hides it.
 */
export default function PageBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="tap -ml-2 mb-1 inline-flex h-11 items-center gap-0.5 rounded-sm pl-1 pr-2 t-button font-medium text-ink-2 hover:bg-surface-2 lg:hidden"
    >
      <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}
