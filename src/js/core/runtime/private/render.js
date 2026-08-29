// Turning a vnode tree into DOM.
// Elements are created in the namespace they belong to. An `<svg>` and
// everything inside it is not HTML: created with createElement it is an
// unknown HTML element that lays out and paints nothing, which is the one way
// this shows up — an icon that is in the DOM and invisible.
import { Fragment } from "./Fragment.js";
import { attrValue, display, readPath, track } from "./bindings.js";
import { MESSAGES } from "../Messages.js";
import { drawInto, isComponentClass, withStyleName } from "./draw.js";
import { flatten } from "./flatten.js";
import { instantiate, isObjectTag, placeholder } from "./objects.js";
import { applyProps, rememberView, scopeFor } from "./scope.js";
import { applyRef, setAttribute } from "./props.js";

/** The SVG namespace, and the element that hands the document back to HTML. */
export const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_ISLAND = "foreignObject";

/** The namespace a `type` element belongs to, given the one around it. */
export function namespaceFor(type, parentNS) {
  if (type === "svg") return SVG_NS;
  if (parentNS === SVG_NS && type === HTML_ISLAND) return null;
  return parentNS ?? null;
}

export function render(vnode, owner = {}, ns = null) {
  if (vnode === null || vnode === undefined || typeof vnode === "boolean") {
    return document.createComment("");
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (vnode.__ibBind === "message") {
    // Not read from the controller: `MESSAGES` is reserved, and the key is
    // looked up in the application's messages. Remembered there rather than in
    // the owner's bindings, because a message depends on the locale and
    // on nothing the owner holds — changing locale writes it again, and
    // no redraw is involved.
    const node = document.createTextNode(MESSAGES.get(vnode.key));
    MESSAGES._bind({ node, key: vnode.key });
    return node;
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
      frag.appendChild(render(child, owner, ns));
    return frag;
  }
  if (vnode instanceof Node) return vnode;

  const { type, props, children } = vnode;

  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    for (const child of children)
      frag.appendChild(render(child, owner, ns));
    return frag;
  }

  if (isComponentClass(type)) {
    // A nested Component subclass draws itself and owns its own redraws. Tagging the
    // node lets a later patch find the instance instead of recreating it.
    // What the tag says, handed over at construction: a component reads its
    // own settings from the moment it exists.
    const view = new type({...props, children });
    const dom = drawInto(view, { ...props, children });
    if (view.node) {
      view.node.__ibView = view;
      view.node.__ibType = type;
    }
    // `outlet="save"` on a component hands the owner the component, not
    // its element: what an owner has to say to a Button is `enabled` or
    // `text`, which are the component's and not the DOM's. On an element the
    // node *is* the thing, so that stays as it was.
    applyRef(props.ref, view);
    return dom;
  }

  // A tag that names an object rather than a view: constructed and handed to
  // its outlet, and nothing is drawn. The comment it leaves behind is where
  // the runtime stands to wake it and to take it down again — see objects.js.
  if (isObjectTag(type)) {
    const node = placeholder(type);
    const { object, applied } = instantiate(type, props);
    node.__ibObj = object;
    node.__ibType = type;
    node.__ibApplied = applied;
    // `outlet="money"` hands over the object itself. There is nothing else it
    // could hand over: the comment is plumbing, not the thing the interface meant.
    applyRef(props.ref, object);
    return node;
  }

  if (typeof type === "function") {
    // Components receive their children as `props.children`, and are invoked
    // with the owner as `this` so `outlet` and `action` bind to it.
    //
    // What it drew is remembered on the node. A plain function has no instance
    // to hold its last tree, and without one a redraw has nothing to compare
    // against and can only throw the node away and build another — which
    // destroys an icon mid-press, and with it the click that press was going
    // to become.
    // A compiled `.ib.xml` placed as a tag is a component: it draws against a
    // scope of its own, and the tag's attributes are that scope's starting
    // state. `Foo.ib.xml` paired with a `FooController.js` beside it draws
    // against a fresh instance of that owner; one written on its own
    // draws against a plain object. Either way its `{bindings}`, outlets and
    // actions are its own and not those of whatever drew it. Kept on the
    // node, because a redraw has to call the view against the same one.
    const own = scopeFor(type, owner);
    const drawnWith = { ...props, children };
    const applied = own !== owner ? applyProps(own, props) : null;
    // `styleName` on the tag is a class the drawing wears, here as it is on a
    // component class — a compiled `.ib.xml` placed as a tag is one of these.
    const produced = withStyleName(type.call(own, drawnWith), props);
    const dom = render(produced, own, ns);
    if (dom?.nodeType === Node.ELEMENT_NODE) {
      dom.__ibFn = type;
      dom.__ibOut = produced;
      if (own !== owner) dom.__ibOwner = own;
    } else if (
      own !== owner &&
      dom?.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    ) {
      // A view with more than one root has no single node to stand for it, so
      // each of them carries the scope. Without this a multi-root `.ib.xml` was
      // the one shape whose scope nothing could be found from. A root that is
      // itself a nested composed view already carries its own owner, set
      // when it drew — stamping this view's scope over it would draw the child
      // against the wrong owner, so it is left as it is.
      for (const node of dom.childNodes) {
        if (node.__ibOwner === undefined) node.__ibOwner = own;
      }
    }
    // What it takes to draw this view again: saying something to its scope is
    // what asks for that, so the scope is where it is kept.
    //
    // Kept only for a view that has a prop to work out — `type.redraws`, which
    // the compiler sets for a file with a bound prop in it. Everything else has
    // nothing a redraw would reach that the binding pass does not, and pays
    // nothing for the difference.
    //
    // A single-root view is patched in place on redraw; a multi-root one has no
    // one node to patch against and is rebuilt instead — but it is remembered
    // either way, so a bound *prop* it hands a child (which is worked out at
    // draw time, not written to the DOM) is redone when its scope changes. Its
    // roots are captured now, before the fragment is inserted and emptied.
    if (own !== owner && type.redraws) {
      if (dom?.nodeType === Node.ELEMENT_NODE) {
        rememberView(own, {
          fn: type,
          props: drawnWith,
          out: produced,
          node: dom,
          nodes: [dom],
          applied,
        });
      } else if (dom?.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        rememberView(own, {
          fn: type,
          props: drawnWith,
          out: produced,
          node: null,
          nodes: [...dom.childNodes],
          applied,
        });
      }
    }
    // `outlet="colours"` on a composed view hands over that view's scope, not
    // the element it drew: what the interface above has to say to it is `show(button)`
    // or `value = 12` — the view's own words — and the element is the view's
    // business. A view written without an owner hands over its scope just
    // the same, so `this.card.value = 12` reaches a `{value}` in a `.ib.xml` that
    // has no class of any kind written for it.
    //
    // The element is still reachable, by the way every view reaches its own:
    // an `outlet` on the root element inside the `.ib.xml`.
    //
    // A function component written by hand has no scope of its own — `own` is
    // the owner that drew it — and hands over its element, as it always
    // has.
    applyRef(props.ref, own !== owner ? own : dom);
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
    el.appendChild(render(child, owner, elementNS));
  return el;
}
