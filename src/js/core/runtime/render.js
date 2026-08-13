// Turning a vnode tree into DOM.
//
// Elements are created in the namespace they belong to. An `<svg>` and
// everything inside it is not HTML: created with createElement it is an
// unknown HTML element that lays out and paints nothing, which is the one way
// this shows up — an icon that is in the DOM and invisible.
import {Fragment} from "./Fragment.js";
import {attrValue, display, readPath, track} from "./private/bindings.js";
import {drawInto, isComponentClass} from "./private/draw.js";
import {flatten} from "./private/flatten.js";
import {applyRef, setAttribute} from "./private/props.js";

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
        track(vnode.controller, {kind: "text", node, path: vnode.path});
        return node;
    }
    if (Array.isArray(vnode)) {
        const frag = document.createDocumentFragment();
        for (const child of flatten(vnode))
            frag.appendChild(render(child, controller, ns));
        return frag;
    }
    if (vnode instanceof Node) return vnode;

    const {type, props, children} = vnode;

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
        const dom = drawInto(view, {...props, children});
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
        const produced = type.call(controller, {...props, children});
        const dom = render(produced, controller, ns);
        if (dom?.nodeType === Node.ELEMENT_NODE) {
            dom.__ibFn = type;
            dom.__ibOut = produced;
        }
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
