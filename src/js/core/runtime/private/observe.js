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

/** Per-object record of what is observed: key -> the callbacks to run. */
const OBSERVED = Symbol.for("mosaic.observed");

/**
 * Properties that belong to the framework rather than to the component's
 * state. They are assigned during drawing and mounting, so observing them
 * would mean a draw scheduling its own redraw.
 */
const INTERNAL = new Set([
  "props", "nodes", "node", "vtree", "listeners", "controller",
  "isAttached", "children", "parent", "view", "root",
]);

function notifiers(target) {
  if (!Object.prototype.hasOwnProperty.call(target, OBSERVED)) {
    Object.defineProperty(target, OBSERVED, { value: new Map(), enumerable: false });
  }
  return target[OBSERVED];
}

/**
 * Watch `key` on `target`: run `notify` whenever it is assigned a new value.
 * Idempotent — observing the same property again only adds the callback, and
 * the property keeps whatever value it already had.
 */
export function observe(target, key, notify) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return;

  const watched = notifiers(target);
  const existing = watched.get(key);
  if (existing) {
    existing.add(notify);
    return;
  }

  const callbacks = new Set([notify]);
  watched.set(key, callbacks);

  const descriptor = Object.getOwnPropertyDescriptor(target, key);

  // An accessor already there stays in charge of the value; observation only
  // wraps its setter, so a computed property keeps computing.
  if (descriptor && !("value" in descriptor)) {
    if (!descriptor.set) return;
    const inner = descriptor.set;
    Object.defineProperty(target, key, {
      get: descriptor.get,
      set(value) {
        inner.call(this, value);
        for (const callback of [...callbacks]) callback();
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
      for (const callback of [...callbacks]) callback();
    },
    enumerable: descriptor ? descriptor.enumerable : true,
    configurable: true,
  });
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
