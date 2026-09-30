// Run: node --experimental-strip-types lib/keyboard.test.ts
import assert from "node:assert/strict";
import { enterOpensSelection } from "./keyboard.ts";

// 1. Nothing focused, or the body: Enter opens the selected story.
assert.equal(enterOpensSelection(null, false), true);
assert.equal(enterOpensSelection({ tag: "BODY", role: null }, false), true);
// 2. The selected row itself (j focuses it) opens it.
assert.equal(enterOpensSelection({ tag: "ARTICLE", role: null }, true), true);
// 3. The QA repro: j, then Tab to the rail's "Later" link. Enter follows the link.
assert.equal(enterOpensSelection({ tag: "A", role: null }, false), false);
// 4. A button elsewhere, or a role=button, keeps its own Enter.
assert.equal(enterOpensSelection({ tag: "BUTTON", role: null }, false), false);
assert.equal(enterOpensSelection({ tag: "DIV", role: "button" }, false), false);
// 5. A button inside the selected row (its Save action) is pressed, not bypassed.
assert.equal(enterOpensSelection({ tag: "BUTTON", role: null }, true), false);
// 6. A non-interactive element outside the selected row does not open it.
assert.equal(enterOpensSelection({ tag: "DIV", role: null }, false), false);
// 7. Tag case does not matter (SVG and XHTML report lower case).
assert.equal(enterOpensSelection({ tag: "a", role: null }, true), false);

console.log("keyboard: all tests pass");
