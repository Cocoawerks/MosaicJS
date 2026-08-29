// Observation: how assigning to a property gets back to the DOM without
// anything having to say so.
//
// Two things drive it. A `{path}` binding names the property it depends on, so
// `track()` can make that one observable directly. A drawn view names nothing —
// `draw()` simply reads what it needs — so the reads themselves are recorded
// while it runs, and every property the drawing depended on becomes one that
// redraws it.
//
// Observation replaces a plain property with an accessor over the same value.
// A property nobody depends on is left alone.

/**
 * Asking a recording proxy for the object behind it. A drawing runs against a
 * proxy so its reads can be recorded, and anything the drawing hands outward —
 * a control passing itself to its action — should be the component, not the
 * wrapper around it.
 */
export const SELF = Symbol.for("mosaic.self");

/** Per-object record of what is observed: key -> the callbacks to run. */
const OBSERVED = Symbol.for("mosaic.observed");

/**
 * What is being told, per object: the keys whose callbacks are running now, and
 * the keys that were assigned while they ran.
 *
 * This is about re-entry: a key assigned again from inside a callback for that
 * same key. An owner that settles a value as it redraws does it, and so
 * does a control that clamps what it was given.
 *
 * It used to be dropped — the second assignment had something new to say and
 * nothing was told, so whatever was watching kept showing the value from
 * before. It is remembered here instead, and told once the pass it interrupted
 * is over.
 *
 * The other way one assignment used to be told about twice — the accessor
 * observation telling after a setter that had already told — is not this. Those
 * two are sequential rather than nested, so no guard here would see them
 * together; they are folded in the wrapped setter itself, which asks whether
 * the setter it wrapped already spoke. See `observe`.
 */
const NOTIFYING = new WeakMap();

/**
 * How many times a drain will go round before it gives up.
 *
 * Two properties that assign one another settle in a pass or two; a pair that
 * never agrees would go round for ever, and a hung tab says nothing about
 * where the loop is. The cap is far above anything that settles, and what it
 * stops is reported rather than swallowed.
 */
const MAX_PASSES = 100;

function state(target) {
  let current = NOTIFYING.get(target);
  if (!current) {
    current = { active: new Set(), pending: new Set(), draining: false };
    NOTIFYING.set(target, current);
  }
  return current;
}

/**
 * How many times each key has been told about, per object.
 *
 * What it is for is the wrapped setter below: it has to know whether the setter
 * it wrapped already told about the assignment, and the count answers that
 * without either of them knowing about the other.
 */
const TOLD = new WeakMap();

/** How many times `key` has been told about so far. */
function tally(target, key) {
  return TOLD.get(target)?.get(key) ?? 0;
}

/** Tell everything watching `key`. */
function tell(target, key) {
  let counts = TOLD.get(target);
  if (!counts) {
    counts = new Map();
    TOLD.set(target, counts);
  }
  counts.set(key, (counts.get(key) ?? 0) + 1);

  const callbacks = target[OBSERVED].get(key);
  if (!callbacks || callbacks.size === 0) return;
  // Copied: a callback may observe or unobserve while it runs.
  for (const callback of [...callbacks]) callback();
}

/**
 * Run whatever is watching `key` on `target`.
 *
 * Exported because observation is not the only thing that assigns: a component
 * keeps its settings in a bag of its own and writes them through
 * `Component.set`, which never goes near the accessor an observer wrapped. A
 * binding onto a control's `value` heard nothing at all until that path told
 * it too.
 *
 * Synchronous, and stays so: `needsDisplay()` promises the DOM is up to date
 * when it returns, and every control here reads back what it just wrote.
 */
export function notify(target, key) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, OBSERVED))
    return;
  const callbacks = target[OBSERVED].get(key);
  if (!callbacks || callbacks.size === 0) return;

  const current = state(target);

  // Already telling this one, so this is an assignment made from inside a
  // callback for it. It is remembered rather than dropped and told below, once
  // the pass it interrupted is over — telling it here would run the callbacks
  // inside themselves.
  if (current.active.has(key)) {
    current.pending.add(key);
    return;
  }

  current.active.add(key);
  try {
    tell(target, key);
  } finally {
    current.active.delete(key);
  }

  // Whatever was assigned while that ran, told now that it can be. Only the
  // outermost notify drains, so a nested one adds to the queue rather than
  // starting a second pass through it.
  if (current.active.size > 0 || current.draining) return;

  current.draining = true;
  try {
    for (let pass = 0; current.pending.size > 0; pass++) {
      if (pass >= MAX_PASSES) {
        const stuck = [...current.pending].join(", ");
        current.pending.clear();
        console.warn(
          `mosaic: ${stuck} kept assigning one another after ${MAX_PASSES} rounds; giving up. Something observing one of these assigns it again.`,
        );
        return;
      }
      const round = [...current.pending];
      current.pending.clear();
      for (const next of round) {
        current.active.add(next);
        try {
          tell(target, next);
        } finally {
          current.active.delete(next);
        }
      }
    }
  } finally {
    current.draining = false;
  }
}

function notifiers(target) {
  if (!Object.prototype.hasOwnProperty.call(target, OBSERVED)) {
    Object.defineProperty(target, OBSERVED, {
      value: new Map(),
      enumerable: false,
    });
  }
  return target[OBSERVED];
}

/**
 * Watch `key` on `target`: run `run` whenever it is assigned a new value.
 * Idempotent — observing the same property again only adds the callback, and
 * the property keeps whatever value it already had.
 */
/**
 * The descriptor for `key`, from wherever it is defined — the object itself or
 * anything it inherits from.
 *
 * Asked of the whole chain rather than the object alone, because an owner
 * is usually a class and a derived value is usually a getter on its prototype.
 * Looking only at own properties found nothing there, so observation took the
 * property for plain state: it read the getter once, kept what came back, and
 * defined an own accessor handing that same answer out for ever. A `{status}`
 * that read `count >= limit` was therefore frozen at whatever it said the first
 * time the interface drew — the getter still existed, and was never called again.
 */
function definedDescriptor(target, key) {
  for (
    let o = target;
    o && o !== Object.prototype;
    o = Object.getPrototypeOf(o)
  ) {
    const found = Object.getOwnPropertyDescriptor(o, key);
    if (found) return found;
  }
  return null;
}

export function observe(target, key, run) {
  if (!target || (typeof target !== "object" && typeof target !== "function"))
    return;

  const watched = notifiers(target);
  const existing = watched.get(key);
  if (existing) {
    existing.add(run);
    return;
  }

  const callbacks = new Set([run]);
  watched.set(key, callbacks);

  const descriptor = definedDescriptor(target, key);

  // An accessor already there stays in charge of the value; observation only
  // wraps its setter, so a computed property keeps computing.
  if (descriptor && !("value" in descriptor)) {
    // Read-only, so there is no assignment to hear about: it is left exactly
    // as it is, and goes on deriving its answer from whatever it reads. A
    // binding on one still comes right, because every binding is re-read
    // whenever anything else the same owner holds is assigned.
    if (!descriptor.set) return;
    const inner = descriptor.set;
    Object.defineProperty(target, key, {
      get: descriptor.get,
      set(value) {
        // Only if the setter did not already say so. A component's declared
        // settings are written through `Component.set`, which tells for itself
        // — so telling again here is the same assignment announced twice, and
        // everything watching ran twice for it: two redraws for every
        // `button.text = "..."`. A setter that tells nobody — a plain one, or
        // one on an owner — still needs this, which is why it is asked
        // rather than assumed either way.
        const before = tally(target, key);
        inner.call(this, value);
        if (tally(target, key) === before) notify(target, key);
      },
      enumerable: descriptor.enumerable,
      configurable: true,
    });
    return;
  }

  if (descriptor && !descriptor.configurable) return;

  let value = descriptor ? descriptor.value : target[key];

  Object.defineProperty(target, key, {
    get() {
      return value;
    },
    set(next) {
      if (Object.is(value, next)) return;
      value = next;
      notify(target, key);
    },
    enumerable: descriptor ? descriptor.enumerable : true,
    configurable: true,
  });
}

/** The redrawing callback each view observes with — see `redrawer`. */
const REDRAWERS = new WeakMap();

/**
 * The one callback that redraws `view`.
 *
 * Observation keeps its callbacks in a set, so observing the same property
 * twice with the same function is the no-op it should be — but only if it is
 * the *same* function. A fresh `() => view.needsDisplay()` each time is a new
 * one, and every drawing would add another: after a hundred redraws a single
 * assignment ran a hundred of them, each of those adding one more. A drawing
 * records its reads every time it runs, which is what made this matter, so
 * what it observes with is remembered here rather than made afresh.
 *
 * @param {object} view The component to redraw.
 * @returns {() => void} The same function every time, for this view.
 */
export function redrawer(view) {
  let run = REDRAWERS.get(view);
  if (!run) {
    run = () => view.needsDisplay();
    REDRAWERS.set(view, run);
  }
  return run;
}

/**
 * Stop running `run` when `key` is assigned.
 *
 * The accessor observation put there stays: it is the property now, and taking
 * it off again would mean putting back whatever was underneath it, which
 * nothing has kept. With no callbacks left it costs an empty loop per
 * assignment and nothing else.
 */
export function unobserve(target, key, run) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, OBSERVED))
    return;
  target[OBSERVED].get(key)?.delete(run);
}

/**
 * Whether `key` can be heard about at all — a property with no setter is one
 * nothing ever assigns, so nothing can be told when it changes.
 */
export function isObservable(target, key) {
  if (!target || (typeof target !== "object" && typeof target !== "function"))
    return false;
  const descriptor = definedDescriptor(target, key);
  if (!descriptor) return true; // Undeclared, so it becomes plain state.
  if ("value" in descriptor) return descriptor.configurable !== false;
  return !!descriptor.set;
}

/**
 * Run `body` against `target` and report which of its properties were read.
 *
 * The object handed to `body` is a proxy that records reads and otherwise
 * behaves as the target. Getters run against that proxy too, so a property
 * derived from others records what it derived from rather than only itself.
 */
export function recordReads(target, body) {
  const reads = new Set();

  const self = new Proxy(target, {
    get(object, key, receiver) {
      if (key === SELF) return object;
      if (typeof key === "string") reads.add(key);
      return Reflect.get(object, key, receiver);
    },
    // Writes belong to the object, not to the proxy: a handler closed over
    // `this` during a draw must assign to the component itself.
    set(object, key, value) {
      return Reflect.set(object, key, value, object);
    },
  });

  const result = body(self);
  return { result, reads };
}

/**
 * The state a derived property reads, so something watching it can watch that
 * instead.
 *
 * A `{path}` binding watches the property it names, and a getter is never
 * assigned — so naming one put a watch on nothing at all. It came right only
 * because a binding is re-read whenever anything else observed on the same
 * owner is assigned, and on an interface where the derived value is the only
 * thing shown there is nothing else: `<Bind source="slider.value"
 * target="amount"/>` feeding a `{formatted}` that reads `amount` left the
 * reading behind the drag until some other part of the interface happened to
 * change.
 *
 * So the getter is run once against a recording proxy and what it read is
 * reported back — the same thing `drawInto` does with a component's `draw()`,
 * and for the same reason.
 *
 * Two things follow from running it rather than reading it. A getter is
 * expected to compute and not to act: one with a side effect has it twice
 * over. And what comes back is what it read *this time*, so a getter that
 * chooses between two properties reports only the branch it took — the other
 * is picked up the next time the binding is registered, which is every time
 * the node it belongs to is drawn again.
 *
 * @param {object} target The owner.
 * @param {string} key The property named by a binding.
 * @returns {string[]} The target's own state that a getter read, or nothing at
 *   all for a property that is not one.
 */
export function derivedKeys(target, key) {
  if (!target || (typeof target !== "object" && typeof target !== "function"))
    return [];

  const descriptor = definedDescriptor(target, key);
  if (!descriptor || "value" in descriptor || !descriptor.get) return [];

  try {
    const { reads } = recordReads(target, (self) => self[key]);
    reads.delete(key);
    return stateKeys(target, reads);
  } catch {
    // A getter that throws is the caller's business — reading it for the
    // value is where that is answered for. Watching is not worth a second
    // failure, so nothing is watched and the binding behaves as it did.
    return [];
  }
}

/**
 * Of the properties read, the ones that are this object's state: its own,
 * enumerable data properties.
 *
 * Four things are turned away, and each for its own reason. A property the
 * object does not own is either a method or a prototype getter — a getter's own
 * reads were recorded alongside it, so what it derives from is watched instead
 * of the getter itself. A method is not state. A field of the runtime's own is
 * not state either, and says so by being non-enumerable: see internal.js for
 * why that rather than a list of names.
 *
 * @param {object} target The component or owner that was drawn.
 * @param {Iterable<string>} reads What the drawing read.
 * @returns {string[]} Which of those to watch.
 */
export function stateKeys(target, reads) {
  const keys = [];
  for (const key of reads) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) continue;
    // The runtime's own — `view.nodes`, `owner.view`. Observing one would
    // mean a draw scheduling its own redraw.
    if (!descriptor.enumerable) continue;
    if (typeof descriptor.value === "function") continue;
    keys.push(key);
  }
  return keys;
}
