import Link from "next/link";
import { ChevronIcon } from "./Icons";

/**
 * A way out of a leaf page. Feed and folder pages had none on mobile: the
 * bottom tabs go to Today/Menu/Later/Read, so once you had drilled into a
 * source there was no route back to where you came from except the browser
 * gesture, which an installed PWA does not have.
 */
export default function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="tap -ml-1 mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink lg:hidden"
    >
      <ChevronIcon className="w-[13px] h-[13px] rotate-180" />
      {label}
    </Link>
  );
}
