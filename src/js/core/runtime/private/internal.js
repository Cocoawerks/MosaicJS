// The fields the runtime keeps on the objects it drives, and how they are told
// apart from the state those objects hold themselves.
//
// A drawing records what it read, and every property it read that is the
// object's own state becomes one that redraws it. The runtime writes to the
// same objects — `view.nodes` as a drawing lands, `controller.view` as a page
// is mounted — and those writes are not state: observing one would mean a draw
// scheduling its own redraw.
//
// They used to be told apart by name, against a list kept here of everything
// the runtime writes. Two things were wrong with that. A field added to the
// runtime and left off the list is an infinite redraw, found at run time and
// nowhere near the change that caused it. And the names are ordinary ones — a
// controller with a `view`, a `root` or a `parent` of its own had that property
// silently left unobserved, so assigning it updated nothing.
//
// So a runtime field says what it is where it is written, by being defined
// non-enumerable. `Object.keys` is then the line between the two: what a page
// wrote is enumerable and what the runtime wrote is not, whatever either is
// called. Nothing has to be listed, and a controller's `view` is its own again.

/**
 * Write a field of the runtime's own onto `target`.
 *
 * Non-enumerable, so `stateKeys` does not take it for the object's state — see
 * the note above. Assignment afterwards keeps the descriptor it is given here,
 * so this is only needed where a field is *first* written: `view.nodes = ...`
 * on a later draw stays non-enumerable on its own.
 *
 * @param {object} target The component, controller or scope written to.
 * @param {string} key The field.
 * @param {*} value What it starts as.
 */
export function internal(target, key, value) {
  if (!target || (typeof target !== "object" && typeof target !== "function"))
    return;
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Whether `key` on `target` is a field of the runtime's rather than the
 * object's own state — the question `stateKeys` asks of every property a
 * drawing read.
 *
 * Only own properties are considered: a prototype's getter is not state either,
 * but it is not a runtime field, and it is turned away for its own reason.
 */
export function isInternal(target, key) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return !!descriptor && !descriptor.enumerable;
}
