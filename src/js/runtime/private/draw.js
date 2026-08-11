// Drawing a component's tree, and recognising a component class.
import { Component } from "../../ui/components/Component.js";
import { render } from "../render.js";

export function drawInto(view, props) {
  view.props = props ?? view.props;
  const vnode = view.draw(view.props);
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
