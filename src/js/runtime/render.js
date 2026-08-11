// Turning a vnode tree into DOM.
import {Fragment} from "./Fragment.js";
import {attrValue, display, readPath, track} from "./private/bindings.js";
import {drawInto, isComponentClass} from "./private/draw.js";
import {flatten} from "./private/flatten.js";
import {setAttribute} from "./private/props.js";

export function render(vnode, controller = {}) {
  if (vnode === null || vnode === undefined || typeof vnode === "boolean") {
    return document.createComment("");
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (vnode.__ibBind === "text") {
    // The binding carries its own controller: it was captured at compile time
    // from the component that declared it.
    const node = document.createTextNode(display(readPath(vnode.controller, vnode.path)));
    track(vnode.controller, { kind: "text", node, path: vnode.path });
    return node;
  }
  if (Array.isArray(vnode)) {
    const frag = document.createDocumentFragment();
    for (const child of flatten(vnode)) frag.appendChild(render(child, controller));
    return frag;
  }
  if (vnode instanceof Node) return vnode;

  const { type, props, children } = vnode;

  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    for (const child of children) frag.appendChild(render(child, controller));
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
    return dom;
  }

  if (typeof type === "function") {
    // Components receive their children as `props.children`, and are invoked
    // with the controller as `this` so `outlet` and `action` bind to it.
    return render(type.call(controller, { ...props, children }), controller);
  }

  const el = document.createElement(type);
  for (const name in props) {
    const value = props[name];
    if (value && value.__ibBind === "attr") {
      setAttribute(el, name, attrValue(value.parts, value.controller));
      track(value.controller, { kind: "attr", node: el, name, parts: value.parts });
      continue;
    }
    setAttribute(el, name, value);
  }
  for (const child of children) el.appendChild(render(child, controller));
  return el;
}
