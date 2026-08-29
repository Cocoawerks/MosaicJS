// Drawing a component's tree, and recognising a component class.
import { coerceProps } from "./coerce.js";
import { Component } from "../Component.js";
import { Fragment } from "./Fragment.js";
import { render } from "./render.js";
import { observe, recordReads, redrawer, stateKeys } from "./observe.js";

export function drawInto(view, props) {
  view.props = props ? coerceProps(props) : view.props;

  // A drawn view declares no bindings — `draw()` simply reads what it needs.
  // Recording those reads is the equivalent of a `{path}` in markup: every
  // property the drawing depended on becomes one that redraws it when it
  // changes, so `needsDisplay()` is only for what this cannot see.
  const { result: vnode, reads } = recordReads(view, (self) =>
    view.draw.call(self, view.props),
  );
  for (const key of stateKeys(view, reads)) {
    observe(view, key, redrawer(view));
  }

  const drawn = withStyleName(vnode, view.props);
  const dom = render(drawn, view);
  const nodes = dom instanceof DocumentFragment ? [...dom.childNodes] : [dom];
  view.nodes = nodes;
  view.node = nodes[0] ?? null;
  view.vtree = drawn;
  view.bindEvents();
  return dom;
}

/**
 * The drawing a component made, wearing whatever class the tag that placed it
 * asked for.
 *
 * `styleName` on a component means "and wear this too". A component decides
 * what it is — a Button draws its own classes and its own face — but the page
 * that placed it may still have something to say about that one of them, and
 * says it the way it would about an element of its own. The class carries the
 * placing page's scope with it, so the page's sheet reaches it.
 *
 * Put on the drawing rather than on the node, so it survives the component
 * drawing itself again: a class written onto the element would be patched off
 * the first time `needsDisplay` ran, since the component's own drawing never
 * mentioned it.
 *
 * A root that is another component carries it down to that one, which is where
 * there is finally an element to put it on. A fragment has no root to wear it.
 */
export function withStyleName(vnode, props) {
  const extra = props?.styleName;
  if (extra === undefined || extra === null || extra === "") return vnode;
  if (!vnode || typeof vnode !== "object" || Array.isArray(vnode)) return vnode;
  if (vnode.type === Fragment) return vnode;

  const own = vnode.props ?? {};
  if (typeof vnode.type === "function") {
    return { ...vnode, props: { ...own, styleName: [own.styleName, extra] } };
  }
  if (typeof vnode.type !== "string") return vnode;
  return { ...vnode, props: { ...own, class: [own.class, extra] } };
}

/**
 * Re-run `draw()` and update the DOM to match, patching the existing nodes
 * rather than rebuilding them. Nodes that keep their position and tag are
 * reused, so focus, scroll position and text selection survive a redraw.

 * Is `type` a component class rather than a plain component function?
 * Recognised structurally — by the `draw()` on its prototype — so a class that
 * reached a second copy of the base still draws correctly.
 */
export function isComponentClass(type) {
  if (typeof type !== "function") return false;
  return (
    type.prototype instanceof Component ||
    typeof type.prototype?.draw === "function"
  );
}
