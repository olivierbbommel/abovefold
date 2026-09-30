"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Library, Search, Sun, type LucideIcon } from "lucide-react";
import { sectionOf, tabOf } from "./sections";

/*
 * Phone tab bar (spec 4.1): Today, Later, Library, Search. Destinations only,
 * never an action (the old "Menu" tab opened a drawer), always all four,
 * never a count. Glass, because it is one of the two places content scrolls
 * underneath a control. Hidden from 64rem up, where the rail takes over.
 *
 * Needs no data, so it renders outside any Suspense boundary and never
 * flashes a skeleton.
 */
const TABS: { key: "today" | "later" | "library" | "search"; href: string; label: string; Icon: LucideIcon }[] = [
  { key: "today", href: "/", label: "Today", Icon: Sun },
  { key: "later", href: "/later", label: "Later", Icon: Bookmark },
  { key: "library", href: "/library", label: "Library", Icon: Library },
  { key: "search", href: "/search", label: "Search", Icon: Search },
];

export default function TabBar() {
  const pathname = usePathname();
  const active = tabOf(sectionOf(pathname));

  return (
    <nav aria-label="Main" className="tabbar glass fixed inset-x-0 bottom-0 z-30 border-t border-hairline lg:hidden">
      <ul className="grid grid-cols-4">
        {TABS.map(({ key, href, label, Icon }) => {
          const on = active === key;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`tab-item flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-0.5 ${
                  on ? "text-accent" : "text-muted"
                }`}
              >
                <Icon
                  className="tab-icon h-6 w-6"
                  strokeWidth={on ? 2.25 : 1.75}
                  fill={on ? "currentColor" : "none"}
                  fillOpacity={on ? 0.18 : 0}
                  aria-hidden="true"
                />
                <span className={`t-tab ${on ? "font-semibold" : ""}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
