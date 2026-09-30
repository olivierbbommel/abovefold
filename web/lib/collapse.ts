/*
 * Remove and restore list rows with motion (spec 3.2).
 *
 * The row's height is measured once and animated to 0 with WAAPI, so rows
 * below ride up with it instead of jumping. Only this one element animates a
 * layout property. Under reduced motion both are instant.
 */
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/*
 * Undo can land mid-collapse. growIn cancels the running animation, whose
 * `.finished` then rejects with AbortError; thrown inside a React transition
 * that took the whole page to the error screen, and an Undo during the hold
 * let the collapse resume afterwards and hide the restored row. Every call
 * bumps the element's generation; a collapse that is no longer current stops
 * where it is, and animations settle instead of throwing.
 */
const generation = new WeakMap<HTMLElement, number>();
const nextGen = (el: HTMLElement) => {
  const g = (generation.get(el) ?? 0) + 1;
  generation.set(el, g);
  return g;
};
const settled = (a: Animation) => a.finished.then(() => true, () => false);

export async function collapseOut(el: HTMLElement, { fadeTo = 0, holdMs = 0 } = {}): Promise<void> {
  const gen = nextGen(el);
  const current = () => generation.get(el) === gen;
  if (reduced()) {
    el.style.display = "none";
    return;
  }
  if (fadeTo > 0) {
    const faded = await settled(
      el.animate([{ opacity: 1 }, { opacity: fadeTo }], { duration: 180, easing: "cubic-bezier(0.2,0,0,1)", fill: "forwards" })
    );
    if (!faded || !current()) return;
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    if (!current()) return;
  }
  const h = el.getBoundingClientRect().height;
  el.style.overflow = "hidden";
  const done = await settled(
    el.animate(
      [
        { height: `${h}px`, opacity: fadeTo || 1 },
        { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", borderBottomWidth: "0px" },
      ],
      { duration: 220, easing: "cubic-bezier(0.2,0,0,1)", fill: "forwards" }
    )
  );
  if (done && current()) el.style.display = "none";
}

export async function growIn(el: HTMLElement): Promise<void> {
  const gen = nextGen(el);
  el.getAnimations().forEach((a) => a.cancel());
  el.style.display = "";
  el.style.overflow = "";
  if (reduced()) return;
  const h = el.getBoundingClientRect().height;
  el.style.overflow = "hidden";
  await settled(
    el.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], {
      duration: 220,
      easing: "cubic-bezier(0.16,1,0.3,1)",
    })
  );
  if (generation.get(el) === gen) el.style.overflow = "";
}

/* Lists that exclude read stories, where archiving should make the row leave. */
export function listDropsReadStories(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/today") ||
    pathname.startsWith("/newsletters")
  );
}
