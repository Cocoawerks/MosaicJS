// Component — the base class every Mosaic component extends.
// It owns four things: the settings pattern (`get`/`set`), the drawing entry
// point (`needsDisplay`), automatic event binding, and the attached/detached
// lifecycle. The drawing and patching machinery itself lives in the runtime,
// which this module and the components below it share.
import { clearBindings } from "./private/clearBindings.js";
import { BROWSER_EVENTS } from "./private/events.js";
import { coerceProps, coerceValue } from "./private/coerce.js";
import { MESSAGES } from "./Messages.js";
import { redraw } from "./private/redraw.js";
import { refresh } from "./private/refresh.js";
import { notify } from "./private/observe.js";
import { prepareSettings } from "./private/settings.js";
import { SELF } from "./private/observe.js";

export { BROWSER_EVENTS };

/**
 * A mounted component: the markup it drew, plus the bindings beneath it.
 * `mount` creates one and hands it to the controller as `this.view`, so a
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
   *   static props = {
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
  static props = {};

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
  static styleName = null;

  /**
   *
   * @param {object} props
   */
  constructor(props = {}) {
    // Once per class, the first time one is built: the accessors its
    // settings ask for, minus any the class writes itself.
    prepareSettings(new.target);

    /**
     * Holds the properties of the component.
     * Not the `static props` a component declares — that is the schema, and
     * what a page sets.
     */
    this.props = coerceProps(props) ?? {};
    this.controller = this.props.controller ?? this;
    /** The root DOM node, set once the tree is rendered. @internal */
    this.node = null;
    /** Every top-level node this view put in the document. @internal */
    this.nodes = [];
    /**
     * The last tree this view drew, kept so a redraw has something to compare
     * against and can patch what changed rather than building it all again.
     *
     * Declared here rather than appearing when something first assigns it, so
     * that what a component holds is said in one place — `destroy()` already
     * put it back to this.
     */
    this.vtree = undefined;
    /** Listeners this component attached, per node, so they can be moved. @private */
    this.listeners = new Map();
    /** Settings assigned through `set()`, taking precedence over props. @private */
    this.overrides = {};
    /** Whether `attached()` has been called and `detached()` has not. @private */
    this.isAttached = false;
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
    MESSAGES._redrawOnLocaleChange(this);
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
    const targets = this.nodes.filter(
      (n) => typeof n?.addEventListener === "function",
    );

    for (const [node, attached] of this.listeners) {
      if (targets.includes(node)) continue;
      for (const type in attached)
        node.removeEventListener(type, attached[type]);
      this.listeners.delete(node);
    }

    for (const node of targets) {
      if (this.listeners.has(node)) continue;
      const attached = {};
      for (const type in BROWSER_EVENTS) {
        const method = BROWSER_EVENTS[type];
        if (typeof this[method] !== "function") continue;
        const listener = (event) => this[method](event);
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
      redraw(this);
      return;
    }
    refresh(this.controller);
  }
}

export default Component;
