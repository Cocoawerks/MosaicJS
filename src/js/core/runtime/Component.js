// Component — the base class every Mosaic component extends.
// It owns four things: the settings pattern (`get`/`set`), the drawing entry
// point (`needsDisplay`), automatic event binding, and the attached/detached
// lifecycle. The drawing and patching machinery itself lives in the runtime,
// which this module and the components below it share.
import { clearBindings } from "./private/clearBindings.js";
import { batch, flushFor, forget, hold } from "./private/batch.js";
import { BROWSER_EVENTS, handledEvents } from "./private/events.js";
import { internal } from "./private/internal.js";
import { coerceProps, coerceValue } from "./private/coerce.js";
import { MESSAGES } from "./Messages.js";
import { redraw } from "./private/redraw.js";
import { refresh } from "./private/refresh.js";
import { notify } from "./private/observe.js";
import { prepareSettings } from "./private/settings.js";
import { SELF } from "./private/observe.js";

export { BROWSER_EVENTS };

/**
 * Where the drawn nodes actually sit. The names `node` and `nodes` are
 * accessors on the class — see below — so the values live under these instead.
 */
const NODE = Symbol("mosaic.node");
const NODES = Symbol("mosaic.nodes");

/**
 * A mounted component: the markup it drew, plus the bindings beneath it.
 * `mount` creates one and hands it to the controller as `this.view`, so an
 * controller stays a plain class:
 *
 *   class Counter {
 *     increment() {
 *       this.count += 1;      // the DOM follows; see needsDisplay() below
 *     }
 *   }
 */
export class Component {
  /**
   * The root DOM node, and every top-level node this view put in the document.
   *
   * Accessors rather than plain fields, because reading one is the moment a
   * held drawing has to have happened. A batch defers drawing until the handler
   * that asked for it is done — but a component that measures what it just drew
   * reaches for its node in the middle of that handler, and has to find the
   * drawing rather than what was there before. Asking here is what lets every
   * such component go on being written the way it was. See private/batch.js.
   *
   * The cost when nothing is owed is a `Set`'s size.
   */
  get node() {
    flushFor();
    return this[NODE];
  }

  set node(value) {
    this[NODE] = value;
  }

  get nodes() {
    flushFor();
    return this[NODES];
  }

  set nodes(value) {
    this[NODES] = value;
  }

  /**
   * This component, unwrapped.
   *
   * A drawing runs against a proxy that records what it read, so `this` inside
   * `draw()` — and inside anything it calls — is that proxy. Handing it out is
   * what makes a control's action arrive with something that is not the
   * control, so anything passing itself outward passes this instead.
   */
  get self() {
    return this[SELF] ?? this;
  }

  /**
   * The settings this component takes, and what each one is.
   *
   *   static properties = {
   *     text:     { type: String },
   *     toggle:   { type: Boolean, default: false },
   *     minValue: { type: Number, default: 0 },
   *   };
   *
   * Each becomes an accessor: reading it gives the value as the type it was
   * declared to be — markup has only text to say a number or a boolean with —
   * and assigning to it repaints. A subclass may redeclare one to narrow its
   * default.
   *
   * A setting whose assignment has to *do* something keeps its hand-written
   * accessor, and declaring it here is how it still says what type it takes:
   * one written by hand always wins over the one this would define.
   */
  static properties = {};

  /**
   * The class this kind of component draws its root with — its primary style
   * name, `v-Button` for a Button.
   *
   * What it is for is stylesheets. A `.ib.xml` may write the component's own
   * name where a class would go —
   *
   *     .mydialog ComboBox { width: 160px; }
   *
   * — and the compiler puts this in its place. A sheet then says what it
   * means, rather than having to know what a combo box calls itself, and a
   * component free to rename its class does not take every sheet that reached
   * it down with it.
   *
   * Usually `v-` and the class's own name, but not always: a DialogBox draws
   * `v-Dialog` and a TabView `v-TabPanel`, so it is declared rather than
   * guessed at. A component drawn as a kind of another — a LoadingButton is a
   * Button — declares nothing and inherits that one's.
   */
  static primaryStyleName = null;

  /**
   *
   * @param {object} props
   */
  constructor(props = {}) {
    // Once per class, the first time one is built: the accessors its
    // settings ask for, minus any the class writes itself.
    prepareSettings(new.target);

    // Every field below belongs to the runtime rather than to the component's
    // state, so each is declared with `internal()` — non-enumerable, which is
    // how a drawing's reads are told apart from what the runtime writes. See
    // private/internal.js. Assignment afterwards keeps that, so this is the
    // only place they have to be declared.
    /**
     * Holds the properties of the component.
     * Not the `static properties` a component declares — that is the schema, and
     * what an interface sets.
     */
    internal(this, "props", coerceProps(props) ?? {});
    internal(this, "controller", this.props.controller ?? this);
    /** The root DOM node, set once the tree is rendered. @internal */
    internal(this, NODE, null);
    /** Every top-level node this view put in the document. @internal */
    internal(this, NODES, []);
    /**
     * The last tree this view drew, kept so a redraw has something to compare
     * against and can patch what changed rather than building it all again.
     *
     * Declared here rather than appearing when something first assigns it, so
     * that what a component holds is said in one place — `destroy()` already
     * put it back to this.
     */
    internal(this, "vtree", undefined);
    /** Listeners this component attached, per node, so they can be moved. @private */
    internal(this, "listeners", new Map());
    /** Settings assigned through `set()`, taking precedence over props. @private */
    internal(this, "overrides", {});
    /** Whether `attached()` has been called and `detached()` has not. @private */
    internal(this, "isAttached", false);
    /** Whether a redraw was asked for before the nodes were on the interface. @private */
    internal(this, "redrawWanted", false);
  }

  /**
   * Lifecycle hooks, both optional and both safe to override without calling
   * `super`: the runtime attaches and removes event listeners itself, before
   * `attached()` and after `detached()` respectively. Overriding one cannot
   * leave a component unbound or leave listeners behind.
   *
   *   attached()  — the component's nodes have been placed in the DOM.
   *                 Listeners are already bound; the nodes can be measured.
   *   detached()  — the component has been removed. Its listeners are already
   *                 gone; release anything else it owns (timers, observers).
   *
   * `attached()` runs once per insertion, not on every redraw.
   *
   * A component has no `awakeFromMib()` — that is a controller's hook, for the
   * `.ib.xml` scope the runtime wakes once its outlets are assigned. A component
   * draws itself and measures itself in `attached()` instead.
   */

  /**
   * A setting's current value: an override once one has been assigned — even
   * `null`, which is how a caller clears one — then the prop, then the default.
   *
   * A method named `get`, not a getter — `get(a, b)` in a class body declares
   * one, since a getter takes a name and no parameters.
   *
   *   get text() { return this.get("text", ""); }
   *
   * @public
   */
  get(name, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.overrides, name)) {
      return this.overrides[name];
    }
    return this.props[name] ?? fallback;
  }

  /**
   * Assign a setting and repaint.
   *
   *   set text(value) { this.set("text", value); }
   *
   * A setting written as `"true"` or `"false"` is stored as the boolean it
   * spells. That is the whole of the conversion, and it belongs here so a
   * boolean setting is written the same way as any other:
   *
   *   set toggle(value) { this.set("toggle", value); }
   *
   * Markup has only text to say a boolean with, so `toggle="false"` arrives
   * as a string that is truthy. Doing it here means no setter has to know
   * that, and none of them can forget.
   *
   * @public
   */
  set(name, value) {
    this.overrides[name] = coerceValue(value);
    this.needsDisplay();
    // And anything watching this setting from outside — a binding onto a
    // control's `value`, a `{path}` that reads it. A component writes its own
    // settings through here rather than through the accessor an observer
    // wrapped, so without this the assignment was invisible to everything but
    // the component's own drawing.
    notify(this, name);
  }

  /**
   *  Post that a property has changed without setting it. For example with
   *  a Slider:
   *
   *   handleMoved() { …; this.changed("value"); }
   *
   * @param {string} name The property whose value has changed.
   */
  changed(name) {
    notify(this, name);
  }

  /**
   * One of this component's own strings, in whichever language the application
   * is being read in.
   *
   *   tooltip={this.message("Close")}
   *   aria-label={this.message("clearSearch")}
   *
   * What `{MESSAGES.close}` is to markup, this is to a component that draws
   * itself. A key is a name: a single English word — `"Close"` — is already its
   * own key, and a phrase is a short one — `"clearSearch"` — with the words it
   * stands for in the framework's `locales/default.json`. Either way a
   * framework's own strings are its own, drawn by its components rather than the
   * application's markup, and this is where they are looked up.
   *
   * Reading one is also what makes this component follow the locale: nothing
   * about a drawn string is a property anything could observe, so the
   * component is remembered instead, and a change of locale draws it again.
   * That is the same bargain `bindProp` makes, with the locale in place of an
   * assignment.
   *
   * @param {string} key The English.
   * @param {object} [params] Values for any `{name}` the message leaves open.
   */
  message(key, params) {
    // `this.self` and not `this`: a drawing runs against a recording proxy, and
    // a fresh one each time it runs. Registered as the proxy, a component was a
    // different dependent on every draw — the register grew a new entry per
    // redraw, and a change of locale then drew the same component once for each
    // of them, each of those adding one more.
    MESSAGES._redrawOnLocaleChange(this.self);
    return params ? MESSAGES.format(key, params) : MESSAGES.get(key);
  }

  /**
   * A value as a strict boolean, for the few settings that have to be one
   * before they are stored — a value compared against the current one, or
   * one kept in a field of the component's own rather than in a setting.
   *
   * `set()` already does this for anything going through it; this is here so
   * that the rest need not reach outside the class for it either.
   *
   *   setValue(value) { const next = this.bool(value); ... }
   *
   * @param {*} value What was assigned.
   * @returns {boolean} What it means.
   */
  bool(value) {
    return !!coerceValue(value);
  }

  /**
   * Attach a listener for every event this component implements a method for,
   * looked up in `BROWSER_EVENTS`. Runs after each draw: nodes that survived
   * a patch keep the listeners they already have, and nodes that were replaced
   * lose theirs.
   *
   * The listener resolves the method when the event fires, so a method can be
   * replaced after mounting.
   */
  bindEvents() {
    // A Set rather than the list itself: what follows asks after every node it
    // has a listener on, and `includes` walks the roots again for each of them.
    // A component with one root never noticed; a list view redrawing two
    // hundred of them was doing forty thousand comparisons a draw.
    const targets = new Set(
      this.nodes.filter((n) => typeof n?.addEventListener === "function"),
    );

    for (const [node, attached] of this.listeners) {
      if (targets.has(node)) continue;
      for (const type in attached)
        node.removeEventListener(type, attached[type]);
      this.listeners.delete(node);
    }

    // Which events this component handles at all — worked out once per class
    // rather than by asking after each of the sixty-odd names on every node of
    // every draw. See events.js.
    let handled = null;

    for (const node of targets) {
      if (this.listeners.has(node)) continue;
      handled ??= handledEvents(this);
      const attached = {};
      for (const [type, method] of handled) {
        // Resolved when the event fires, not now, so a method can be replaced
        // after mounting. Run as a batch, so a handler settling several fields
        // draws once instead of once per assignment — the drawing still happens
        // before the handler returns.
        const listener = (event) => batch(() => this[method](event));
        node.addEventListener(type, listener);
        attached[type] = listener;
      }
      this.listeners.set(node, attached);
    }
  }

  /**
   * Subclasses may implement `draw(props)` and return a tree — JSX compiled to
   * `h()` calls — instead of writing a `.ib.xml` file:
   *
   *   class Counter extends Component {
   *     draw() {
   *       return <View styleName="counter">{this.count}</View>;
   *     }
   *   }
   *
   * `draw` is optional: a view backed by a `.ib.xml` component leaves it undefined.
   */

  /**
   * Release this component: remove every listener it attached, drop its
   * bindings and forget its nodes. Called for you when the component leaves
   * the document, so a removed subtree does not keep listeners — or the
   * component itself — alive.
   *
   * A subclass may implement `detached()` to do its own cleanup.
   */
  destroy() {
    // A drawing owed to a component that is going is not owed any more.
    forget(this);
    // Listeners go first, so an overridden detached() cannot leave any behind.
    for (const [node, attached] of this.listeners) {
      for (const type in attached)
        node.removeEventListener(type, attached[type]);
    }
    this.listeners.clear();

    clearBindings(this.controller ?? this);

    this.nodes = [];
    this.node = null;
    this.vtree = undefined;

    if (this.isAttached) {
      this.isAttached = false;
      this.detached?.();
    }
  }

  /**
   * Update the DOM to match current state. A drawn view re-runs `draw()` and
   * replaces its nodes; a `.ib.xml`-backed view re-reads its `{path}` bindings.
   * Either way it applies immediately.
   *
   * Rarely needed: a property a `{path}` binds to, or that `draw()` reads, is
   * observed, so assigning to it already does this. What observation cannot
   * see is a change that assigns nothing — mutating an object or an array in
   * place, `this.items.push(x)` — and that is what this is for.
   *
   * @public
   */
  needsDisplay() {
    if (typeof this.draw === "function") {
      // Held until the handler that asked is done, so four assignments draw
      // once rather than four times. Outside a batch this is false and the
      // drawing happens here, exactly as it always did. See private/batch.js.
      if (hold(this)) return;
      redraw(this);
      return;
    }
    refresh(this.controller);
  }
}

export default Component;
