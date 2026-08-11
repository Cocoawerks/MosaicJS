// Drawing a component's tree, and recognising a component class.
import {Component} from "../Component.js";
import {render} from "../render.js";
import {observe, recordReads, stateKeys} from "./observe.js";

export function drawInto(view, props) {
  view.props = props ?? view.props;

  // A drawn view declares no bindings — `draw()` simply reads what it needs.
  // Recording those reads is the equivalent of a `{path}` in markup: every
  // property the drawing depended on becomes one that redraws it when it
  // changes, so `needsDisplay()` is only for what this cannot see.
  const {result: vnode, reads} = recordReads(view, (self) => view.draw.call(self, view.props));
  for (const key of stateKeys(view, reads)) {
    observe(view, key, () => view.needsDisplay());
  }

  const dom = render(vnode, view);
  const nodes = dom instanceof DocumentFragment ? [...dom.childNodes] : [dom];
  view.nodes = nodes;
  view.node = nodes[0] ?? null;
  view.vtree = vnode;
  view.bindEvents();
  return dom;
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
  return type.prototype instanceof Component || typeof type.prototype?.draw === "function";
}
