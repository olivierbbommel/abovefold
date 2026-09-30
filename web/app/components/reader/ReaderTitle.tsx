"use client";

import { ViewTransition } from "react";

/*
 * The reader title shares `story-<id>` with the headline of the row it was
 * opened from (StoryRow sets it as a plain style), so the headline morphs
 * into the title (spec 3.2). React only starts a view transition when a
 * <ViewTransition> takes part in the commit, which is why the name lives on
 * one here rather than on a style. Rendered by both the route's loading
 * state and the page, and never inside a Suspense boundary of its own
 * (spec 8.5.1), so the title is present in the very first commit.
 */
export default function ReaderTitle({ id, children }: { id: number; children: React.ReactNode }) {
  return (
    <ViewTransition name={`story-${id}`}>
      <h1 className="reader-title t-reader-title text-ink">{children}</h1>
    </ViewTransition>
  );
}
