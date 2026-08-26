// Declared settings: turning a component's `static properties` into accessors.
//
// A component's props already reach it — markup attributes and JSX props land
// in `this.props`, and `get()` reads them. What an accessor adds is the four
// things `this.get(name, default)` cannot say on its own: what the setting is
// called, what it defaults to, what type it is, and that assigning to it should
// repaint. Written by hand that is four lines per setting and the same four
// lines in every component; declared, it is one:
//
//   static properties = {
//     text:    { type: String },
//     toggle:  { type: Boolean, default: false },
//     minValue: { type: Number, default: 0 },
//   };
//
// A component that needs assignment to *do* something still writes the accessor
// by hand — a value that has to be clamped, a knob that has to move, a timer
// that has to start. A hand-written one always wins; declaring the setting
// beside it is how it says what type and default it takes.
import { BROWSER_EVENTS } from "./events.js";
import { coerceValue } from "./coerce.js";

/** Classes whose accessors have been defined, so it is done once each. */
const prepared = new WeakSet();

/**
 * The accessors this module wrote.
 *
 * A subclass that narrows a setting has to be able to tell its parent's
 * generated accessor — which it may replace — from one written by hand, which
 * it may not. Without this a subclass inherits the parent's default and its
 * own declaration is quietly ignored.
 */
const generated = new WeakSet();

/**
 * Names a setting may not take.
 *
 * A method named for an event is how a component handles that event, so a
 * setting of the same name would replace the handler and the component would
 * quietly stop hearing it — which is a real afternoon lost, and the reason this
 * throws rather than warns.
 */
const RESERVED = new Set([
  ...Object.values(BROWSER_EVENTS),
  "attached",
  "detached",
  "destroy",
  "draw",
  "get",
  "set",
  "bool",
  "props",
  "properties",
  "overrides",
  "node",
  "nodes",
  "self",
  "controller",
  "needsDisplay",
  "message",
  "bindEvents",
  "isAttached",
  "listeners",
  "vtree",
]);

/** A value as the type its setting was declared to be. */
function castValue(spec, value) {
  // Nothing was said, or it was cleared. Either is the answer.
  if (value === undefined || value === null) return value;

  if (spec.type === Boolean) return !!coerceValue(value);
  if (spec.type === Number) {
    const number = Number(value);
    return Number.isNaN(number) ? (spec.default ?? 0) : number;
  }
  return value;
}

/**
 * Every setting a class declares, its ancestors' included.
 *
 * Walked base-first, so a subclass that redeclares a setting — a narrower
 * default, usually — is the one that counts.
 */
function declaredSettings(type) {
  const chain = [];
  for (
    let t = type;
    t && t !== Function.prototype;
    t = Object.getPrototypeOf(t)
  ) {
    if (Object.prototype.hasOwnProperty.call(t, "properties"))
      chain.unshift(t.properties);
  }
  return Object.assign({}, ...chain);
}

/** The descriptor for `name`, from wherever up the chain it is defined. */
function definedDescriptor(prototype, name) {
  for (
    let p = prototype;
    p && p !== Object.prototype;
    p = Object.getPrototypeOf(p)
  ) {
    const found = Object.getOwnPropertyDescriptor(p, name);
    if (found) return found;
  }
  return null;
}

/**
 * Give `type` an accessor for each setting it declares and does not already
 * have one for. Runs once per class, the first time one is constructed.
 *
 * @param {Function} type The component class.
 */
export function prepareSettings(type) {
  if (!type || prepared.has(type)) return;
  prepared.add(type);

  const settings = declaredSettings(type);
  const prototype = type.prototype;

  for (const name of Object.keys(settings)) {
    if (RESERVED.has(name)) {
      throw new Error(
        `${type.name}: \`${name}\` cannot be a setting — the name belongs to ` +
          `a component's own methods, and a setting would take its place.`,
      );
    }

    const spec = settings[name] ?? {};
    const written = definedDescriptor(prototype, name);

    // A data property of the same name would shadow the accessor. Only one
    // on the prototype can be seen from here — a field assigned in a
    // constructor is set after this runs — but that is the one worth
    // catching, and better said than debugged.
    if (written && !written.get && !written.set) {
      throw new Error(
        `${type.name}: \`${name}\` is declared as a setting but is also a ` +
          `field. One of the two has to go — a field shadows the accessor.`,
      );
    }

    // A hand-written accessor wins. That is the whole escape hatch: a
    // setting whose assignment has to do something declares its type and
    // default here and writes the accessor itself.
    //
    // Half of one wins too. A class that writes only the setter would
    // otherwise shadow the inherited getter and read back undefined — a
    // JavaScript trap that has already cost this framework a comment or
    // two — so the missing half is filled in from the declaration.
    //
    // One this module wrote is not hand-written, and a subclass narrowing
    // the setting replaces it rather than inheriting the parent's default.
    const byHand = (fn) => (fn && !generated.has(fn) ? fn : null);
    const handGet = byHand(written?.get);
    const handSet = byHand(written?.set);
    if (handGet && handSet) continue;

    const get =
      handGet ??
      function () {
        return castValue(spec, this.get(name, spec.default));
      };
    const set =
      handSet ??
      function (value) {
        this.set(name, castValue(spec, value));
      };

    if (!handGet) generated.add(get);
    if (!handSet) generated.add(set);

    Object.defineProperty(prototype, name, {
      configurable: true,
      enumerable: false,
      get,
      set,
    });
  }
}

/**
 * A declared setting's value, for the places that read one without going
 * through its accessor — a parent reading a child's props off the vnode.
 *
 * @param {Function} type The component class the setting belongs to.
 * @param {string} name The setting.
 * @param {*} value What the props hold.
 * @returns {*} The value, as its declared type.
 */
export function settingValue(type, name, value) {
  const spec = declaredSettings(type)[name] ?? {};
  return castValue(spec, value ?? spec.default);
}
