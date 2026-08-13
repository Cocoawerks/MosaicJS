// Telling components they have entered or left the document.

/**
 * Tell every component in a freshly inserted subtree that it is in the DOM,
 * children before parents. Components already attached are skipped, so a
 * redraw only notifies what is new. Listeners were bound during the draw,
 * before this runs.
 */
export function attachTree(node) {
    if (!node) return;

    // Depth first: a parent's attached() can rely on its children being ready.
    const children = node.childNodes ? [...node.childNodes] : [];
    for (const child of children) attachTree(child);

    const view = node.__ibView;
    if (view && !view.isAttached) {
        view.isAttached = true;
        view.attached?.();
    }
}

/**
 * Release every component in a subtree that is about to leave the document.
 * Called before a node is removed, while its children can still be walked.
 */
export function disposeTree(node) {
    if (!node) return;

    const view = node.__ibView;
    if (view) {
        node.__ibView = null;
        node.__ibType = null;
        view.destroy();
    }

    const children = node.childNodes ? [...node.childNodes] : [];
    for (const child of children) disposeTree(child);
}

/** Remove a node from the document, releasing the components inside it. */
export function discard(node) {
    disposeTree(node);
    node.remove();
}
