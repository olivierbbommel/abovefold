/*
 * Whether Enter should open the keyboard-selected story (KeyboardNav).
 *
 * Enter belongs to whatever has focus. A selection made with j/k used to win
 * over it: Tab to the rail's "Later" link, press Enter, and you landed on the
 * selected article instead. So Enter opens the selection only when focus is
 * nowhere in particular (the body) or somewhere non-interactive inside the
 * selected row, which includes the row itself, since j focuses it.
 */
export type FocusedElement = { tag: string; role: string | null };

const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "tab", "checkbox", "switch", "option", "textbox"]);

export function enterOpensSelection(focused: FocusedElement | null, insideSelectedRow: boolean): boolean {
  if (!focused) return true;
  const tag = focused.tag.toUpperCase();
  if (tag === "BODY" || tag === "HTML") return true;
  if (INTERACTIVE_TAGS.has(tag)) return false;
  if (focused.role && INTERACTIVE_ROLES.has(focused.role)) return false;
  return insideSelectedRow;
}
