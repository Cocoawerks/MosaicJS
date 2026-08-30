// Putting a component into the document.
import { Component } from "../Component.js";
import { coerceProps } from "./coerce.js";
import { drawInto, isComponentClass } from "./draw.js";
import { attachTree, discard, disposeTree } from "./lifecycle.js";
import { render } from "./render.js";
import { internal } from "./internal.js";
import { rememberView } from "./scope.js";

/** What `mount` was given when it was given no owner at all. */
const EMPTY = Symbol("no owner");

export function mount(component, target, props = {}, owner = EMPTY) {
  // A Component subclass draws itself, so it is its own owner and needs
  // no other. Mounting one with nothing said used to hand it an empty object
  // to answer to, which is an owner that knows nothing and holds nothing —
  // and the component then read its own state through something that was not
  // it. A component without an owner is the ordinary case, not a gap to
  // fill.
  const said = owner !== EMPTY && owner !== null && owner !== undefined;

  if (isComponentClass(component)) {
    // Built from what it is being mounted with, the owner among the
    // props: a component takes one object, and mounting is placing it.
    const view = new component({...props,...(said ? { owner: owner } : {}) });
    if (said && owner !== view) {
      view.owner = owner;
      // The runtime's own field on the interface's owner, not state the interface
      // holds — see internal.js. An owner with a `view` of its own meaning
      // something else keeps it: this is only reached when one was passed in.
      internal(owner, "view", view);
    }
    const dom = drawInto(view, props);
    // Only if nothing else has claimed it — the same guard the composed branch
    // below makes, for the same reason and against the same mistake.
    //
    // A mounted component's root may itself be a component: a Wizard's view
    // draws a dialog and nothing else, so the node standing for the one is the
    // node standing for the other. Written over, the tag named the outer
    // component while the vnode there named the inner one — and a patch that
    // finds those two disagreeing cannot reuse what is there, so it built the
    // inner component again from nothing on every redraw of the outer one.
    //
    // What that cost was everything the inner component was holding. A dialog
    // told to open and then redrawn came back closed, because the instance that
    // had been told was gone: the wizard's mask went up over a dialog that was
    // never shown.
    if (view.node && !view.node.__ibView) {
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
    internal(unmount, "view", view);
    return unmount;
  }

  // Otherwise: a compiled `.ib.xml` component. The owner reaches its view as
  // `this.view`; it does not inherit from it.
  //
  // An interface may carry an owner of its own — `Foo.ib.xml` paired with the
  // `FooController.js` beside it. What the caller passes wins, since mounting
  // an interface by hand and naming its owner is saying which to use; an interface
  // mounted with nothing said uses the one written for it.
  if (owner === EMPTY) {
    owner = component?.owner ? new component.owner() : {};
  }

  const view = new Component({...props, owner: owner });
  view.owner = owner;
  internal(owner, "view", view);

  const vnode =
    typeof component === "function"
      ? component.call(owner, props)
      : component;
  const dom = render(vnode, owner);
  const nodes = dom instanceof DocumentFragment ? [...dom.childNodes] : [dom];
  view.nodes = nodes;
  view.node = nodes[0] ?? null;
  view.props = coerceProps(props);
  // Only if nothing else has claimed it. The first root may itself be a
  // component — an interface whose markup opens with one — and that component's own
  // instance is what a patch has to find there, and what `attachTree` has to
  // tell. Written over it, the component was never attached at all: its
  // `attached()` did not run, and the interface wrapper standing in its place has
  // none.
  if (view.node && !view.node.__ibView) view.node.__ibView = view;
  // The owner is this interface's scope, tagged onto its roots the way a
  // composed view's is — which is what `attachTree` finds to tell it the interface
  // is on screen. An interface mounted as the application's own goes through here
  // rather than through `render`, and without this its `attached()` was the
  // one that never ran.
  //
  // Every root, not only the first: an interface whose markup has more than one is
  // as much that interface at the last of them as at the first, and something
  // written there — a `<Bind/>` after the markup it joins up — has to be able
  // to find the interface it is in by looking upward.
  //
  // And only where nothing else has claimed it, for the reason `__ibView`
  // above is guarded. A root may itself be a composed `.ib.xml` with a
  // owner of its own — an interface whose markup opens with `<PublishView/>` —
  // and `render` has already tagged that node with it. Written over, that
  // view's scope was not reachable from its own node: `attachTree` found the
  // interface's owner there, told it a second time, and the composed view was
  // never told at all, so its `awakeFromMib` and `attached` never ran.
  for (const node of nodes) node.__ibOwner ??= owner;

  // An interface draws itself again the way a composed view does, so a value reaches
  // a component's prop here too — `<Button text="{label}"/>` in an interface is the
  // same thing it is anywhere else. Only an interface that has such a prop, though:
  // `redraws` is what the compiler sets for a file with one, and an interface
  // without one keeps the binding pass it has always had. A single-root interface is
  // patched in place; a multi-root one is rebuilt — either way it is remembered,
  // so a bound prop it hands a component is redone when the interface's state changes.
  if (typeof component === "function" && component.redraws && nodes.length > 0) {
    const single =
      nodes.length === 1 && nodes[0]?.nodeType === Node.ELEMENT_NODE;
    rememberView(owner, {
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

  // And the interface itself, if the walk did not reach it. An interface is told through
  // whichever root carries its owner, and an interface whose every root is a
  // composed view — `<PublishView/>` and `<WelcomeDialog/>` and nothing else —
  // carries it on none of them: each of those nodes belongs to the view drawn
  // there. The interface is on screen just the same, and `awakeFromMib()` is where a
  // owner joins its outlets together, which is exactly what an interface made of
  // composed views has to do. It is an owner, so it wakes and no more —
  // `attached()` is a component's hook.
  if (owner && !owner.isAttached) {
    internal(owner, "isAttached", true);
    owner.awakeFromMib?.();
  }

  const unmount = () => {
    for (const node of nodes) discard(node);
    view.destroy();
  };
  internal(unmount, "view", view);
  return unmount;
}
