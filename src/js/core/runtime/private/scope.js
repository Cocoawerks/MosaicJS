// The scope a compiled `.mib` draws against when it is placed as a tag.
//
// A `.mib` file is a component: `<Labelled label="Name"/>` in one file reaches
// `Labelled.mib` beside it, and nothing has to be written as a class. What
// makes it a component rather than an include is this — it draws against a
// scope of its own, and the tag's attributes are what that scope starts with.
import { coerceProps } from "../coerce.js";

/**
 * Props the runtime uses itself. They are how a component is placed rather
 * than anything the view holds, so they are not part of its state.
 */
const PLUMBING = new Set(["children", "ref", "key"]);

/**
 * The object a composed `.mib` draws against — what its `{bindings}` read and
 * what its actions are called on.
 *
 * A file paired with a `FooController.js` beside it draws against a fresh
 * instance of that controller. One written on its own draws against a plain
 * object of its own, so a view composed twice is two views: neither can reach
 * into the state of whatever drew it, and what it was handed stays its own.
 */
export function scopeFor(type, controller) {
  if (type?.controller) return new type.controller();
  // A view compiled from markup is a component and gets a scope of its own,
  // even with no controller written for it: the tag's attributes have to land
  // somewhere, and a view that reached into the state of whatever drew it
  // would not be composable twice.
  if (type?.isMarkup) return {};
  // Anything else is a function component written by hand — an icon, a small
  // helper — which has drawn against its caller's controller since before any
  // of this, and still does.
  return controller;
}

/**
 * Hand the tag's attributes to the scope, so `<Labelled label="Name"/>` is a
 * view whose `{label}` reads "Name" and whose controller reads `this.label`.
 *
 * Assigned onto the scope rather than kept beside it, because that is what
 * makes a prop ordinary state: a `{binding}` observes the property it reads,
 * so a prop that arrives this way is watched like anything else and a redraw
 * carrying a new value updates the DOM. Assigning a value that has not changed
 * is a no-op, so replaying them on every redraw costs nothing.
 *
 * They land before the view draws, which is the only moment they can: a
 * `{binding}` has to have something to read the first time round. A controller
 * whose setter reaches for something the markup draws — an outlet — will not
 * find it yet, and should take what it needs in `attached()` instead.
 *
 * @param {object} scope What the view draws against.
 * @param {object} props What its tag says.
 * @param {object} [previous] What the tag said last time, so an attribute that
 *   has not changed is left alone.
 * @returns {object} What the tag says now, to compare against next time.
 */
export function applyProps(scope, props, previous) {
  if (!scope || !props) return previous ?? {};

  const coerced = coerceProps(props);
  for (const name in coerced) {
    if (PLUMBING.has(name)) continue;
    // Only what the tag has actually changed since the last draw. A view that
    // has been told something through its outlet — `card.value = 12` — keeps
    // it: the markup still says `value="0"`, and replaying that on every
    // redraw of the page above would put the 0 back. What the markup says is
    // where the view starts; what changes it afterwards is whichever of the
    // two spoke last.
    if (previous && Object.is(previous[name], coerced[name])) continue;
    scope[name] = coerced[name];
  }
  return coerced;
}


/**
 * What a composed view needs to draw itself again: the function the compiler
 * made of its markup, the props it was placed with, the last tree it produced
 * and the node that tree became.
 *
 * Kept on the scope, non-enumerable, so a view is redrawn by saying something
 * to it and nothing has to hold a handle to it.
 */
export const VIEW = Symbol.for("mosaic.view");

/** Remember how to draw `scope` again. */
export function rememberView(scope, record) {
  if (!scope || typeof scope !== "object") return;
  Object.defineProperty(scope, VIEW, {
    value: record,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * How a view is redrawn, filled in by the patcher when it loads.
 *
 * A hook rather than an import: the patcher already reaches this module, and
 * asking for it back from here would be a cycle between the two.
 */
let redrawHook = null;

export function setViewRedraw(fn) {
  redrawHook = fn;
}

/**
 * Draw `scope`'s view again, patching what it produced last time into what it
 * produces now.
 *
 * @returns {boolean} Whether it was redrawn. A scope with no view behind it —
 * a controller a page was mounted with by hand, an object that only holds
 * bindings — is left to the binding pass instead.
 */
export function redrawView(scope) {
  return redrawHook ? redrawHook(scope) : false;
}
