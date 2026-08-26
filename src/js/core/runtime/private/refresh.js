// Bringing what a controller drew back up to date.
//
// Two ways, and which one is used depends on what is behind the controller. A
// composed view — a `.ib.xml` placed as a tag — draws itself again and patches
// what changed, so a value reaches a child component as readily as it reaches a
// text node. Anything else has no function to re-run, and its `{path}`
// bindings are pushed back into the DOM one at a time.
import { attrValue, BINDINGS, display, readPath } from "./bindings.js";
import { setAttribute } from "./props.js";
import { redrawView } from "./scope.js";

export function refresh(controller) {
  // A view draws itself again, which reaches everything its markup holds.
  if (redrawView(controller)) return;

  const entries = controller?.[BINDINGS];
  if (!entries) return;

  let live = 0;
  for (const entry of entries) {
    if (!entry.node.isConnected && entry.node.parentNode === null) continue;
    if (entry.kind === "text") {
      const next = display(readPath(controller, entry.path));
      if (entry.node.textContent !== next) entry.node.textContent = next;
    } else {
      const next = attrValue(entry.parts, controller);
      if (entry.node.getAttribute(entry.name) !== next) {
        setAttribute(entry.node, entry.name, next);
      }
    }
    entries[live++] = entry;
  }
  entries.length = live;
}
