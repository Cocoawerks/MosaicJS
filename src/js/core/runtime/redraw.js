// Re-running draw() and patching the result into place. The patcher lives here
// because nothing else uses it: a redraw is the only thing that reconciles two
// drawings.
import {Fragment} from "./Fragment.js";
import {coerceProps} from "./coerce.js";
import {render, SVG_NS} from "./render.js";
import {attrValue, BINDINGS, display, readPath, track,} from "./private/bindings.js";
import {drawInto, isComponentClass} from "./private/draw.js";
import {flatten} from "./private/flatten.js";
import {attachTree, discard} from "./private/lifecycle.js";
import {applyRef, setAttribute} from "./private/props.js";

export function redraw(view) {
    const anchor = view.nodes[0];
    // Nothing to patch against yet: the component has drawn but its nodes have
    // not been put anywhere — which is where they are when an `outlet` hands a
    // component over and the controller says something to it straight away. The
    // redraw is remembered rather than dropped, and done when the nodes land
    // (see `attachTree`); dropping it loses whatever was just assigned.
    if (!anchor || !anchor.parentNode) {
        if (anchor) view.redrawWanted = true;
        return;
    }

    const parent = anchor.parentNode;
    const previous = view.vtree;
    const next = view.draw(view.props);

    // Bindings and outlets are re-registered against whichever nodes survive.
    if (Object.prototype.hasOwnProperty.call(view, BINDINGS))
        view[BINDINGS].length = 0;

    // A multi-root draw has no single node to patch against; rebuild those.
    if (view.nodes.length !== 1 || previous === undefined) {
        const before = view.nodes[view.nodes.length - 1].nextSibling;
        const stale = view.nodes;
        const dom = drawInto(view, view.props);
        parent.insertBefore(dom, before);
        for (const node of stale) discard(node);
        for (const node of view.nodes) attachTree(node);
        return;
    }

    const node = patch(parent, view.nodes[0], previous, next, view);
    view.nodes = [node];
    view.node = node;
    view.vtree = next;
    view.bindEvents();
    attachTree(node);
}

/** Vnodes of different shapes can never patch into one another. */
function sameKind(a, b) {
    if (a == null || b == null) return a === b;
    const at = kindOf(a);
    const bt = kindOf(b);
    if (at !== bt) return false;
    if (at === "element") return a.type === b.type && a.props.key === b.props.key;
    return true;
}

/**
 * The namespace a child of `parent` is created in. Read off the DOM rather
 * than tracked alongside it: the node in hand already knows what it is. A
 * `<foreignObject>` is the exception — it is an SVG element whose children are
 * HTML again.
 */
function nsOf(parent) {
    if (parent?.namespaceURI !== SVG_NS) return null;
    return parent.tagName === "foreignObject" ? null : SVG_NS;
}

function kindOf(vnode) {
    if (typeof vnode === "string" || typeof vnode === "number") return "text";
    if (vnode.__ibBind === "text") return "text";
    if (vnode.type === Fragment) return "fragment";
    if (isComponentClass(vnode.type) || typeof vnode.type === "function")
        return "component";
    return "element";
}

/** The text a text-ish vnode should display. */
function textOf(vnode, controller) {
    if (vnode.__ibBind === "text") {
        const value = display(readPath(vnode.controller, vnode.path));
        return {value, bind: vnode};
    }
    return {value: String(vnode), bind: null};
}

/**
 * Patch `dom` from `oldV` to `newV`, returning the node now in its place.
 * Falls back to replacing the node whenever the two cannot be reconciled.
 */
function patch(parent, dom, oldV, newV, controller) {
    if (newV == null || typeof newV === "boolean") {
        const placeholder = document.createComment("");
        parent.insertBefore(placeholder, dom);
        discard(dom);
        return placeholder;
    }

    if (!sameKind(oldV, newV)) {
        const fresh = render(newV, controller, nsOf(parent));
        parent.insertBefore(fresh, dom);
        discard(dom);
        return fresh;
    }

    switch (kindOf(newV)) {
        case "text": {
            const {value, bind} = textOf(newV, controller);
            if (dom.textContent !== value) dom.textContent = value;
            if (bind)
                track(bind.controller, {kind: "text", node: dom, path: bind.path});
            return dom;
        }

        case "component": {
            // A nested view owns its own drawing; hand it the new props and let it
            // decide, so its state survives the parent's redraw.
            const view = dom.__ibView;
            if (view && dom.__ibType === newV.type) {
                const props = coerceProps({...newV.props, children: newV.children});
                // Outlets are cleared before a redraw, so the one pointing at this
                // component has to be set again — it is the same component either way.
                applyRef(newV.props.ref, view);
                if (!sameProps(view.props, props)) {
                    view.props = props;
                    view.needsDisplay();
                    return view.node ?? dom;
                }
                return dom;
            }
            // A plain function component — an icon, a small helper — has no instance
            // to hand props to, but it does leave behind what it drew. Draw it again
            // and patch the two trees, so its DOM survives rather than being rebuilt
            // under whatever is pointing at it.
            if (
                !isComponentClass(newV.type) &&
                typeof newV.type === "function" &&
                dom.__ibFn === newV.type
            ) {
                // The one this page was first drawn against: a page with a
                // controller of its own keeps it across redraws, or its state
                // would be built again every time anything above it changed.
                const own = dom.__ibCtl ?? controller;
                const produced = newV.type.call(own, {
                    ...newV.props,
                    children: newV.children,
                });
                const patched = patch(parent, dom, dom.__ibOut, produced, own);
                if (patched?.nodeType === Node.ELEMENT_NODE) {
                    patched.__ibFn = newV.type;
                    patched.__ibOut = produced;
                    if (dom.__ibCtl) patched.__ibCtl = own;
                }
                return patched;
            }

            const fresh = render(newV, controller, nsOf(parent));
            parent.insertBefore(fresh, dom);
            discard(dom);
            return fresh;
        }

        case "fragment": {
            patchChildren(dom, oldV.children, newV.children, controller);
            return dom;
        }

        default: {
            patchProps(dom, oldV.props, newV.props, controller);
            patchChildren(dom, oldV.children, newV.children, controller);
            return dom;
        }
    }
}

/** Children are matched by position; a `key` prop guards against reordering. */
function patchChildren(parent, oldChildren = [], newChildren = [], controller) {
    const olds = flatten(oldChildren);
    const news = flatten(newChildren);
    const nodes = [...parent.childNodes];

    const count = Math.max(olds.length, news.length);
    for (let i = 0; i < count; i++) {
        const oldV = olds[i];
        const newV = news[i];
        const node = nodes[i];

        if (newV === undefined) {
            if (node) discard(node);
            continue;
        }
        if (node === undefined || oldV === undefined) {
            parent.appendChild(render(newV, controller, nsOf(parent)));
            continue;
        }
        patch(parent, node, oldV, newV, controller);
    }
}

/** Add, update and remove props, undoing anything the previous draw set. */
function patchProps(el, oldProps = {}, newProps = {}, controller) {
    for (const name in oldProps) {
        if (!(name in newProps)) removeProp(el, name, oldProps[name]);
    }
    for (const name in newProps) {
        const next = newProps[name];
        const prev = oldProps[name];

        // Bound attributes and refs are re-applied every draw: the value may have
        // changed even when the vnode looks identical.
        if (next && next.__ibBind === "attr") {
            setAttribute(el, name, attrValue(next.parts, next.controller));
            track(next.controller, {
                kind: "attr",
                node: el,
                name,
                parts: next.parts,
            });
            continue;
        }
        if (name === "ref") {
            setAttribute(el, name, next);
            continue;
        }
        if (prev === next) continue;

        if (typeof prev === "function" && name.startsWith("on")) {
            el.removeEventListener(name.slice(2).toLowerCase(), prev);
        }
        setAttribute(el, name, next);
    }
}

function removeProp(el, name, value) {
    if (name.startsWith("on") && typeof value === "function") {
        el.removeEventListener(name.slice(2).toLowerCase(), value);
        return;
    }
    if (name === "ref" || name === "children" || name === "key") return;
    el.removeAttribute(name === "className" ? "class" : name);
}

/** Shallow comparison, enough to decide whether a child view needs redrawing. */
function sameProps(a = {}, b = {}) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => a[k] === b[k]);
}
