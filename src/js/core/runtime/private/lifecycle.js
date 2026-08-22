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
    // Anything assigned before it was on the page is drawn now: `redraw`
    // could not patch a component whose nodes had nowhere to be.
    if (view.redrawWanted) {
      view.redrawWanted = false;
      view.needsDisplay();
    }
    view.attached?.();
  }

  // A compiled `.mib` draws against a scope of its own rather than a component
  // instance — its controller — and that is where a page's own code lives. It
  // is told the same thing at the same moment: outlets are assigned as the
  // markup draws, so `attached()` is the first point at which a controller can
  // see every control the page placed, which is what joining two of them
  // together needs.
  const scope = node.__ibCtl;
  if (scope && !scope.isAttached) {
    scope.isAttached = true;
    scope.attached?.();
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

  // And a page's controller is told it is going, so what it set up on the way
  // in — a binding holds both of its ends — can be undone.
  const scope = node.__ibCtl;
  if (scope?.isAttached) {
    scope.isAttached = false;
    scope.detached?.();
  }

  const children = node.childNodes ? [...node.childNodes] : [];
  for (const child of children) disposeTree(child);
}

/** Remove a node from the document, releasing the components inside it. */
export function discard(node) {
  disposeTree(node);
  node.remove();
}
