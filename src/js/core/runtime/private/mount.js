// Putting a component into the document.
import { Component } from "../Component.js";
import { coerceProps } from "./coerce.js";
import { drawInto, isComponentClass } from "./draw.js";
import { attachTree, discard, disposeTree } from "./lifecycle.js";
import { render } from "./render.js";
import { rememberView } from "./scope.js";

/** What `mount` was given when it was given no controller at all. */
const EMPTY = Symbol("no controller");

export function mount(component, target, props = {}, controller = EMPTY) {
  // A Component subclass draws itself, so it is its own controller and needs
  // no other. Mounting one with nothing said used to hand it an empty object
  // to answer to, which is a controller that knows nothing and holds nothing —
  // and the component then read its own state through something that was not
  // it. A component without a controller is the ordinary case, not a gap to
  // fill.
  const said = controller !== EMPTY && controller !== null && controller !== undefined;

  if (isComponentClass(component)) {
    // Built from what it is being mounted with, the controller among the
    // props: a component takes one object, and mounting is placing it.
    const view = new component({...props,...(said ? { controller } : {}) });
    if (said && controller !== view) {
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

  // Otherwise: a compiled `.ib.xml` component. The controller reaches its view as
  // `this.view`; it does not inherit from it.
  //
  // A page may carry a controller of its own — `Foo.ib.xml` paired with the
  // `FooController.js` beside it. What the caller passes wins, since mounting
  // a page by hand and naming its controller is saying which to use; a page
  // mounted with nothing said uses the one written for it.
  if (controller === EMPTY) {
    controller = component?.controller ? new component.controller() : {};
  }

  const view = new Component({...props, controller });
  view.controller = controller;
  controller.view = view;

  const vnode =
    typeof component === "function"
      ? component.call(controller, props)
      : component;
  const dom = render(vnode, controller);
  const nodes = dom instanceof DocumentFragment ? [...dom.childNodes] : [dom];
  view.nodes = nodes;
  view.node = nodes[0] ?? null;
  view.props = coerceProps(props);
  // Only if nothing else has claimed it. The first root may itself be a
  // component — a page whose markup opens with one — and that component's own
  // instance is what a patch has to find there, and what `attachTree` has to
  // tell. Written over it, the component was never attached at all: its
  // `attached()` did not run, and the page wrapper standing in its place has
  // none.
  if (view.node && !view.node.__ibView) view.node.__ibView = view;
  // The controller is this page's scope, tagged onto its roots the way a
  // composed view's is — which is what `attachTree` finds to tell it the page
  // is on screen. A page mounted as the application's own goes through here
  // rather than through `render`, and without this its `attached()` was the
  // one that never ran.
  //
  // Every root, not only the first: a page whose markup has more than one is
  // as much that page at the last of them as at the first, and something
  // written there — a `<Bind/>` after the markup it joins up — has to be able
  // to find the page it is in by looking upward.
  //
  // And only where nothing else has claimed it, for the reason `__ibView`
  // above is guarded. A root may itself be a composed `.ib.xml` with a
  // controller of its own — a page whose markup opens with `<PublishView/>` —
  // and `render` has already tagged that node with it. Written over, that
  // view's scope was not reachable from its own node: `attachTree` found the
  // page's controller there, told it a second time, and the composed view was
  // never told at all, so its `awakeFromMib` and `attached` never ran.
  for (const node of nodes) node.__ibCtl ??= controller;

  // A page draws itself again the way a composed view does, so a value reaches
  // a component's prop here too — `<Button text="{label}"/>` in a page is the
  // same thing it is anywhere else. Only a page that has such a prop, though:
  // `redraws` is what the compiler sets for a file with one, and a page
  // without one keeps the binding pass it has always had. A single-root page is
  // patched in place; a multi-root one is rebuilt — either way it is remembered,
  // so a bound prop it hands a component is redone when the page's state changes.
  if (typeof component === "function" && component.redraws && nodes.length > 0) {
    const single =
      nodes.length === 1 && nodes[0]?.nodeType === Node.ELEMENT_NODE;
    rememberView(controller, {
      fn: component,
      props,
      out: vnode,
      node: single ? nodes[0] : null,
      nodes,
    });
  }

  target.textContent = "";
  target.appendChild(dom);
  for (const node of nodes) attachTree(node);

  // And the page itself, if the walk did not reach it. A page is told through
  // whichever root carries its controller, and a page whose every root is a
  // composed view — `<PublishView/>` and `<WelcomeDialog/>` and nothing else —
  // carries it on none of them: each of those nodes belongs to the view drawn
  // there. The page is on screen just the same, and `awakeFromMib()` is where a
  // controller joins its outlets together, which is exactly what a page made of
  // composed views has to do. It is a controller, so it wakes and no more —
  // `attached()` is a component's hook.
  if (controller && !controller.isAttached) {
    controller.isAttached = true;
    controller.awakeFromMib?.();
  }

  const unmount = () => {
    for (const node of nodes) discard(node);
    view.destroy();
  };
  unmount.view = view;
  return unmount;
}
