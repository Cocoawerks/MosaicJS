// Telling components they have entered or left the document.
import { internal } from "./internal.js";

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

  // A drawn component gets `attached()` — it is on the interface, its nodes can be
  // measured. That is a component's lifecycle hook, not an owner's.
  const view = node.__ibView;
  if (view && !view.isAttached) {
    view.isAttached = true;
    // Anything assigned before it was on the interface is drawn now: `redraw`
    // could not patch a component whose nodes had nowhere to be.
    if (view.redrawWanted) {
      view.redrawWanted = false;
      view.needsDisplay();
    }
    view.attached?.();
  }

  // An object a tag placed is woken the same way an owner is, and for the
  // same reason: the markup has drawn, so every outlet is assigned and
  // everything the interface placed can be reached. It has no `attached()` — that
  // is a component's, and an object is not on the interface.
  //
  // Whether it has been woken is remembered on the node rather than on the
  // object: a tag may name an object rather than a class, and one object
  // placed by two interfaces is one object. The node is per placement, which is
  // what "woken" is about.
  const object = node.__ibObj;
  if (object && !node.__ibAwake) {
    node.__ibAwake = true;
    object.awakeFromMib?.();
  }

  // A compiled `.ib.xml` draws against a scope of its own rather than a
  // component instance — its owner — and that gets `awakeFromMib()`
  // instead: the markup has drawn, so every outlet is assigned and every
  // control the file placed can be reached, which is what joining two of them
  // together needs. An owner has no `attached()`; that is a component's.
  const scope = node.__ibOwner;
  if (scope && scope !== view && !scope.isAttached) {
    // The runtime's own field on the view's scope rather than state the scope
    // holds — see internal.js. Declared on the first write; the one in
    // `disposeTree` below is an assignment and keeps it.
    internal(scope, "isAttached", true);
    scope.awakeFromMib?.();
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

  // An object the interface placed is told it is going, so what it set up — a
  // subscription, a timer, a binding, which holds both of its ends — can be
  // undone. A singleton named by two interfaces hears it once per placement, which
  // is once per interface that placed it.
  const object = node.__ibObj;
  if (object) {
    node.__ibObj = null;
    node.__ibType = null;
    if (node.__ibAwake) {
      node.__ibAwake = false;
      object.detached?.();
    }
  }

  // And an interface's owner is told it is going, so what it set up on the way
  // in — a binding holds both of its ends — can be undone.
  const scope = node.__ibOwner;
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
