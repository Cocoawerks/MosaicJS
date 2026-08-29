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
 * Properties that belong to the framework rather than to the component's
 * state. They are assigned during drawing and mounting, so observing them
 * would mean a draw scheduling its own redraw.
 */
const INTERNAL = new Set([
  "props",
  "nodes",
  "node",
  "vtree",
  "listeners",
  "controller",
  "isAttached",
  "children",
  "parent",
  "view",
  "root",
]);

/**
 * Keys currently telling their callbacks, per object.
 *
 * A component assigned through its public setter notifies twice over: the
 * accessor observation wraps the setter and tells afterwards, and the setter
 * itself reaches `Component.set`, which tells as well. Both are needed —
 * either path may be the only one taken — so the second is folded into the
 * first rather than removed.
 */
const NOTIFYING = new WeakMap();

/**
 * Run whatever is watching `key` on `target`.
 *
 * Exported because observation is not the only thing that assigns: a component
 * keeps its settings in a bag of its own and writes them through
 * `Component.set`, which never goes near the accessor an observer wrapped. A
 * binding onto a control's `value` heard nothing at all until that path told
 * it too.
 */
export function notify(target, key) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, OBSERVED))
    return;
  const callbacks = target[OBSERVED].get(key);
  if (!callbacks || callbacks.size === 0) return;

  let busy = NOTIFYING.get(target);
  if (!busy) {
    busy = new Set();
    NOTIFYING.set(target, busy);
  }
  if (busy.has(key)) return;

  busy.add(key);
  try {
    for (const callback of [...callbacks]) callback();
  } finally {
    busy.delete(key);
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
 * Asked of the whole chain rather than the object alone, because a controller
 * is usually a class and a derived value is usually a getter on its prototype.
 * Looking only at own properties found nothing there, so observation took the
 * property for plain state: it read the getter once, kept what came back, and
 * defined an own accessor handing that same answer out for ever. A `{status}`
 * that read `count >= limit` was therefore frozen at whatever it said the first
 * time the page drew — the getter still existed, and was never called again.
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
    // whenever anything else the same controller holds is assigned.
    if (!descriptor.set) return;
    const inner = descriptor.set;
    Object.defineProperty(target, key, {
      get: descriptor.get,
      set(value) {
        inner.call(this, value);
        notify(target, key);
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
 * Of the properties read, the ones that are this object's state: its own data
 * properties. A method, a prototype getter, and the framework's own fields are
 * not state — a getter's own reads were recorded alongside it, so what it
 * derives from is watched instead.
 */
/**
 * The state a derived property reads, so something watching it can watch that
 * instead.
 *
 * A `{path}` binding watches the property it names, and a getter is never
 * assigned — so naming one put a watch on nothing at all. It came right only
 * because a binding is re-read whenever anything else observed on the same
 * controller is assigned, and on a page where the derived value is the only
 * thing shown there is nothing else: `<Bind source="slider.value"
 * target="amount"/>` feeding a `{formatted}` that reads `amount` left the
 * reading behind the drag until some other part of the page happened to
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
 * @param {object} target The controller.
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

export function stateKeys(target, reads) {
  const keys = [];
  for (const key of reads) {
    if (INTERNAL.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) continue;
    if (typeof descriptor.value === "function") continue;
    keys.push(key);
  }
  return keys;
}
