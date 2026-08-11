// Putting a component into the document.
import { Component } from "../ui/components/Component.js";
import { drawInto, isComponentClass } from "./private/draw.js";
import { attachTree, discard, disposeTree } from "./private/lifecycle.js";
import { render } from "./render.js";

export function mount(component, target, props = {}, controller = {}) {
  // A Component subclass draws itself; it is its own controller.
  if (isComponentClass(component)) {
    const view = new component(controller === undefined ? null : controller);
    if (controller && controller !== view) {
      view.controller = controller;
      controller.view = view;
    }
    const dom = drawInto(view, props);
    if (view.node) {
      view.node.__ibView = view;
      view.node.__ibType = component;
    }
    target.textContent = "";
    target.appendChild(dom);
    for (const node of view.nodes) attachTree(node);

    const unmount = () => {
      // Taken before disposal: destroy() clears view.nodes, so reading it
      // twice would leave the nodes in the document.
      const drawn = [...view.nodes];
      for (const node of drawn) disposeTree(node);
      for (const node of drawn) node.remove();
      view.destroy();
    };
    unmount.view = view;
    return unmount;
  }

  // Otherwise: a compiled `.ib` component. The controller reaches its view as
  // `this.view`; it does not inherit from it.
  const view = new Component(controller);
  view.controller = controller;
  controller.view = view;

  const vnode =
    typeof component === "function" ? component.call(controller, props) : component;
  const dom = render(vnode, controller);
  const nodes = dom instanceof DocumentFragment ? [...dom.childNodes] : [dom];
  view.nodes = nodes;
  view.node = nodes[0] ?? null;
  view.props = props;
  if (view.node) view.node.__ibView = view;

  target.textContent = "";
  target.appendChild(dom);
  for (const node of nodes) attachTree(node);

  const unmount = () => {
    for (const node of nodes) discard(node);
    view.destroy();
  };
  unmount.view = view;
  return unmount;
}
