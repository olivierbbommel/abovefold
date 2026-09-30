/*
 * Tabs swap content with a 150ms crossfade, no slide (spec 3.2: a slide
 * implies a spatial order the tabs do not have). A template remounts on
 * navigation, which is what restarts the fade; the layout above it, with the
 * rail and tab bar, stays put. Opacity only, and off under reduced motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="tab-swap flex min-w-0 flex-1">{children}</div>;
}
