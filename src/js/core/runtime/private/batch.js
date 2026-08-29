// Doing several assignments' worth of drawing once.
//
// A handler settling four fields drew four times: each assignment told its
// watchers, and each of those re-ran `draw()` and patched the result. Three of
// those drawings were thrown away by the next one. React batches the same case
// into one render, and this is that — with one difference that the rest of this
// file is about.
//
// Mosaic's drawing is synchronous and things here depend on it. A menu assigns
// its lines and then measures the rows it just drew to place itself; a slider
// writes a value and reads the width back. Deferring a redraw to a microtask —
// which is how batching is usually done — would leave those reading a DOM that
// has not caught up, and the failure is a menu in the wrong place rather than
// an error anyone could follow.
//
// So the redraws are held only for as long as nothing needs to see them, and
// anything that reaches for the DOM flushes them first. `flushFor` is that
// door: `Component.node` and `Component.nodes` call it before answering, which
// is how every one of those measurements gets what it expects without knowing
// any of this exists. Held work is never *skipped*, only deferred to the end of
// the handler — which is still before the browser paints, and before anything
// outside the handler can look.

/** Views with a drawing owed, in the order they asked. */
const PENDING = new Set();

/** How many batches are open. Zero means a redraw happens where it is asked for. */
let depth = 0;

/** Whether a flush is running, so a redraw inside one is not held again. */
let flushing = false;

/**
 * Run `body` with drawing held back, then draw whatever it asked for — once per
 * view however many times each was asked.
 *
 * Nested calls join the batch they are inside: only the outermost flushes, so a
 * handler calling another handler's work still draws once.
 *
 * @param {Function} body What to run.
 * @returns {*} Whatever `body` returned.
 */
export function batch(body) {
  depth += 1;
  try {
    return body();
  } finally {
    depth -= 1;
    if (depth === 0) flush();
  }
}

/**
 * Hold `view`'s drawing until the batch ends, or say that there is no batch and
 * it should draw now.
 *
 * @returns {boolean} Whether it was held. False means the caller draws itself.
 */
export function hold(view) {
  // Inside a flush, a redraw is the drawing being done rather than another one
  // being asked for. Holding it would put it back in the queue it came out of.
  if (depth === 0 || flushing) return false;
  PENDING.add(view);
  return true;
}

/**
 * Draw everything owed, now.
 *
 * A drawing may ask for another — a component that assigns something as it
 * draws — so this goes round until nothing is owed rather than over one list.
 */
export function flush() {
  if (flushing || PENDING.size === 0) return;

  flushing = true;
  try {
    // Guarded the way `notify`'s drain is, and for the same reason: two views
    // that redraw one another would go round for ever, and a hung tab says
    // nothing about which two.
    for (let pass = 0; PENDING.size > 0; pass++) {
      if (pass >= 100) {
        PENDING.clear();
        console.warn(
          "mosaic: drawing kept asking for more drawing after 100 rounds; giving up. Something's draw() assigns state that redraws it.",
        );
        return;
      }
      const owed = [...PENDING];
      PENDING.clear();
      for (const view of owed) view.needsDisplay();
    }
  } finally {
    flushing = false;
  }
}

/**
 * Draw what is owed before someone looks at the DOM.
 *
 * Called from `Component.node` and `Component.nodes`, which is how anything
 * measuring or searching what it just drew — a menu placing itself by the rows
 * it has, a slider reading its own width — sees the drawing rather than what
 * was there before it. Everything is flushed and not only the view being asked
 * after: what is being reached for is usually a *child's* node, and a parent's
 * held drawing is what puts the child there.
 *
 * The cost when nothing is owed is a `Set`'s size, which is what makes it
 * affordable on a property every drawing reads.
 */
export function flushFor() {
  if (PENDING.size > 0) flush();
}

/** Whether anything is owed — for tests, and for `destroy` to stop asking. */
export function forget(view) {
  PENDING.delete(view);
}
