"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import ArticleBackButton from "@/app/components/ArticleBackButton";
import ReaderTopBar from "@/app/components/reader/ReaderTopBar";
import ReaderTitle from "@/app/components/reader/ReaderTitle";

/*
 * The reader while the article streams in. Same bar, same column, same
 * title position as page.tsx, so nothing moves when the real page lands.
 *
 * On a client navigation this renders before the list is torn down, so the
 * headline of the row you tapped is still in the document. Reading it here
 * puts the real title in the first frame, which is also what lets the
 * headline morph into the title (spec 3.2): the row's `story-<id>` and this
 * title's are both on screen in the same transition. On a direct load, or
 * from a link that is not a story row, it is a skeleton title instead.
 */

function titleFromRow(id: number): string | null {
  if (typeof document === "undefined" || !Number.isInteger(id)) return null;
  const name = `story-${id}`;
  for (const el of document.querySelectorAll<HTMLElement>("h1, h2")) {
    if (el.style.viewTransitionName === name) return el.textContent?.trim() || null;
  }
  return null;
}

export default function Loading() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [title] = useState(() => titleFromRow(id));

  return (
    <main className="reader flex-1 min-w-0 bg-bg" aria-busy="true">
      <ReaderTopBar>
        {Number.isInteger(id) && id > 0 ? <ArticleBackButton articleId={id} /> : <span />}
        <div className="flex items-center gap-0.5 lg:gap-1" aria-hidden="true">
          <span className="h-11 w-11 lg:h-9 lg:w-9" />
          <span className="h-11 w-11 lg:h-9 lg:w-9" />
          <span className="h-11 w-11 lg:h-9 lg:w-9" />
        </div>
      </ReaderTopBar>

      <div className="reader-column px-5 lg:px-10">
        <div className="mx-auto max-w-[640px] pt-3 lg:pt-10">
          {title ? (
            <ReaderTitle id={id}>{title}</ReaderTitle>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="skeleton h-[1.875rem] w-full rounded-sm lg:h-[2.375rem]" />
              <div className="skeleton h-[1.875rem] w-2/3 rounded-sm lg:h-[2.375rem]" />
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5">
            <div className="skeleton h-4 w-4 rounded-xs" />
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-3 w-20" />
          </div>

          <div className="mt-5 rounded-lg bg-ai-bg p-4">
            <div className="skeleton h-3 w-20" />
            <div className="mt-3 flex flex-col gap-2">
              <div className="skeleton h-3.5 w-full" />
              <div className="skeleton h-3.5 w-11/12" />
              <div className="skeleton h-3.5 w-3/4" />
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-[0.6875rem]">
                <div className="skeleton h-[1.125rem] w-full" />
                <div className="skeleton h-[1.125rem] w-full" />
                <div className="skeleton h-[1.125rem] w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
