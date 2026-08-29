// Bringing what an owner drew back up to date.
//
// Two ways, and which one is used depends on what is behind the owner. A
// composed view — a `.ib.xml` placed as a tag — draws itself again and patches
// what changed, so a value reaches a child component as readily as it reaches a
// text node. Anything else has no function to re-run, and its `{path}`
// bindings are pushed back into the DOM one at a time.
import { BINDINGS, writeEntry } from "./bindings.js";
import { redrawView } from "./scope.js";

export function refresh(owner) {
  // A view draws itself again, which reaches everything its markup holds.
  if (redrawView(owner)) return;

  const entries = owner?.[BINDINGS];
  if (!entries) return;

  let live = 0;
  for (const entry of entries) {
    if (!writeEntry(owner, entry)) continue;
    entries[live++] = entry;
  }
  entries.length = live;
}
