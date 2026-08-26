// Children arrive nested (a list renders an array), may hold blanks, and may
// hold fragments. This is the one place that says what a child list *is*: `h`
// levels every child list through it as a vnode is made, and the patcher asks
// it again when it lines a drawing up against the nodes already there.

import { Fragment } from "./Fragment.js";

/**
 * Flatten a child list, dropping null, undefined and booleans.
 *
 * A fragment is leveled out too: its children belong to whatever holds the
 * fragment, and `render` draws them straight into it. Left whole, a fragment
 * would be one entry standing for however many nodes it drew — and a patch
 * lines entries up against nodes one for one, so every child after it would be
 * patched against the wrong node. What that looked like: a snackbar's content
 * is a fragment, and redrawing one reached for the comment standing in for its
 * absent icon, took that comment to be the fragment's element, and tried to
 * append to it. A comment has no children, so the browser refused.
 */
export function flatten(children, out = []) {
  for (const child of children) {
    if (Array.isArray(child)) flatten(child, out);
    else if (child?.type === Fragment) flatten(child.children ?? [], out);
    else if (
      child !== null &&
      child !== undefined &&
      child !== false &&
      child !== true
    ) {
      out.push(child);
    }
  }
  return out;
}
