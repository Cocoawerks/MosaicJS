// Turning a vnode tree into DOM.
//
// Elements are created in the namespace they belong to. An `<svg>` and
// everything inside it is not HTML: created with createElement it is an
// unknown HTML element that lays out and paints nothing, which is the one way
// this shows up — an icon that is in the DOM and invisible.
import { Fragment } from "./Fragment.js";
import { attrValue, display, readPath, track } from "./private/bindings.js";
import { drawInto, isComponentClass } from "./private/draw.js";
import { flatten } from "./private/flatten.js";
import { applyProps, rememberView, scopeFor } from "./private/scope.js";
import { applyRef, setAttribute } from "./private/props.js";

/** The SVG namespace, and the element that hands the document back to HTML. */
export const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_ISLAND = "foreignObject";

/** The namespace a `type` element belongs to, given the one around it. */
export function namespaceFor(type, parentNS) {
  if (type === "svg") return SVG_NS;
  if (parentNS === SVG_NS && type === HTML_ISLAND) return null;
  return parentNS ?? null;
}

export function render(vnode, controller = {}, ns = null) {
  if (vnode === null || vnode === undefined || typeof vnode === "boolean") {
    return document.createComment("");
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (vnode.__ibBind === "text") {
    // The binding carries its own controller: it was captured at compile time
    // from the component that declared it.
    const node = document.createTextNode(
      display(readPath(vnode.controller, vnode.path)),
    );
    track(vnode.controller, { kind: "text", node, path: vnode.path });
    return node;
  }
  if (Array.isArray(vnode)) {
    const frag = document.createDocumentFragment();
    for (const child of flatten(vnode))
      frag.appendChild(render(child, controller, ns));
    return frag;
  }
  if (vnode instanceof Node) return vnode;

  const { type, props, children } = vnode;

  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    for (const child of children)
      frag.appendChild(render(child, controller, ns));
    return frag;
  }

  if (isComponentClass(type)) {
    // A nested Component subclass draws itself and owns its own redraws. Tagging the
    // node lets a later patch find the instance instead of recreating it.
    const view = new type(null);
    const dom = drawInto(view, { ...props, children });
    if (view.node) {
      view.node.__ibView = view;
      view.node.__ibType = type;
    }
    // `outlet="save"` on a component hands the controller the component, not
    // its element: what a controller has to say to a Button is `enabled` or
    // `text`, which are the component's and not the DOM's. On an element the
    // node *is* the thing, so that stays as it was.
    applyRef(props.ref, view);
    return dom;
  }

  if (typeof type === "function") {
    // Components receive their children as `props.children`, and are invoked
    // with the controller as `this` so `outlet` and `action` bind to it.
    //
    // What it drew is remembered on the node. A plain function has no instance
    // to hold its last tree, and without one a redraw has nothing to compare
    // against and can only throw the node away and build another — which
    // destroys an icon mid-press, and with it the click that press was going
    // to become.
    // A compiled `.mib` placed as a tag is a component: it draws against a
    // scope of its own, and the tag's attributes are that scope's starting
    // state. `Foo.mib` paired with a `FooController.js` beside it draws
    // against a fresh instance of that controller; one written on its own
    // draws against a plain object. Either way its `{bindings}`, outlets and
    // actions are its own and not those of whatever drew it. Kept on the
    // node, because a redraw has to call the view against the same one.
    const own = scopeFor(type, controller);
    const drawnWith = { ...props, children };
    const applied = own !== controller ? applyProps(own, props) : null;
    const produced = type.call(own, drawnWith);
    const dom = render(produced, own, ns);
    if (dom?.nodeType === Node.ELEMENT_NODE) {
      dom.__ibFn = type;
      dom.__ibOut = produced;
      if (own !== controller) dom.__ibCtl = own;
    }
    // What it takes to draw this view again: saying something to its scope is
    // what asks for that, so the scope is where it is kept.
    //
    // Kept only for a view that has a prop to work out — `type.redraws`, which
    // the compiler sets for a file with a bound prop in it. Everything else has
    // nothing a redraw would reach that the binding pass does not, and pays
    // nothing for the difference. A view with more than one root has no single
    // node to patch against and is left to the binding pass too.
    if (
      own !== controller &&
      type.redraws &&
      dom?.nodeType === Node.ELEMENT_NODE
    ) {
      rememberView(own, {
        fn: type,
        props: drawnWith,
        out: produced,
        node: dom,
        applied,
      });
    }
    // `outlet="colours"` on a composed view hands over that view's scope, not
    // the element it drew: what the page above has to say to it is `show(button)`
    // or `value = 12` — the view's own words — and the element is the view's
    // business. A view written without a controller hands over its scope just
    // the same, so `this.card.value = 12` reaches a `{value}` in a `.mib` that
    // has no class of any kind written for it.
    //
    // The element is still reachable, by the way every view reaches its own:
    // an `outlet` on the root element inside the `.mib`.
    //
    // A function component written by hand has no scope of its own — `own` is
    // the controller that drew it — and hands over its element, as it always
    // has.
    applyRef(props.ref, own !== controller ? own : dom);
    return dom;
  }

  const elementNS = namespaceFor(type, ns);
  const el =
    elementNS === null
      ? document.createElement(type)
      : document.createElementNS(elementNS, type);
  for (const name in props) {
    const value = props[name];
    if (value && value.__ibBind === "attr") {
      setAttribute(el, name, attrValue(value.parts, value.controller));
      track(value.controller, {
        kind: "attr",
        node: el,
        name,
        parts: value.parts,
      });
      continue;
    }
    setAttribute(el, name, value);
  }
  for (const child of children)
    el.appendChild(render(child, controller, elementNS));
  return el;
}
