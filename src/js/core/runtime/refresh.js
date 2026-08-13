// Pushing `{path}` bindings back into the DOM.
import {attrValue, BINDINGS, display, readPath} from "./private/bindings.js";
import {setAttribute} from "./private/props.js";

export function refresh(controller) {
    const entries = controller?.[BINDINGS];
    if (!entries) return;

    let live = 0;
    for (const entry of entries) {
        if (!entry.node.isConnected && entry.node.parentNode === null) continue;
        if (entry.kind === "text") {
            const next = display(readPath(controller, entry.path));
            if (entry.node.textContent !== next) entry.node.textContent = next;
        } else {
            const next = attrValue(entry.parts, controller);
            if (entry.node.getAttribute(entry.name) !== next) {
                setAttribute(entry.node, entry.name, next);
            }
        }
        entries[live++] = entry;
    }
    entries.length = live;
}
