// Component — the base class every Mosaic component extends.
//
// It owns four things: the settings pattern (`get`/`set`), the drawing entry
// point (`needsDisplay`), automatic event binding, and the attached/detached
// lifecycle. The drawing and patching machinery itself lives in the runtime,
// which this module and the components below it share.
import {clearBindings} from "./clearBindings.js";
import {redraw} from "./redraw.js";
import {refresh} from "./refresh.js";

/**
 * Every DOM event a component can handle, mapped to the method name that
 * handles it. Implement `pointerDown(event)` and the component is wired to
 * "pointerdown" automatically — no `action` attribute and no `on` prefix.
 *
 * A method here is claimed by the event system, so a component must not use
 * one of these names for anything else.
 */
export const BROWSER_EVENTS = Object.freeze({
  // pointer
  click: "click",
  dblclick: "dblClick",
  auxclick: "auxClick",
  contextmenu: "contextMenu",
  pointerdown: "pointerDown",
  pointerup: "pointerUp",
  pointermove: "pointerMove",
  pointerenter: "pointerEnter",
  pointerleave: "pointerLeave",
  pointerover: "pointerOver",
  pointerout: "pointerOut",
  pointercancel: "pointerCancel",
  gotpointercapture: "gotPointerCapture",
  lostpointercapture: "lostPointerCapture",
  // mouse
  mousedown: "mouseDown",
  mouseup: "mouseUp",
  mousemove: "mouseMove",
  mouseenter: "mouseEnter",
  mouseleave: "mouseLeave",
  mouseover: "mouseOver",
  mouseout: "mouseOut",
  wheel: "wheel",
  // touch
  touchstart: "touchStart",
  touchend: "touchEnd",
  touchmove: "touchMove",
  touchcancel: "touchCancel",
  // keyboard
  keydown: "keyDown",
  keyup: "keyUp",
  keypress: "keyPress",
  // focus
  focus: "focus",
  blur: "blur",
  focusin: "focusIn",
  focusout: "focusOut",
  // form
  input: "input",
  beforeinput: "beforeInput",
  change: "change",
  submit: "submit",
  reset: "reset",
  invalid: "invalid",
  select: "select",
  // drag and drop
  dragstart: "dragStart",
  drag: "drag",
  dragend: "dragEnd",
  dragenter: "dragEnter",
  dragover: "dragOver",
  dragleave: "dragLeave",
  drop: "drop",
  // clipboard
  copy: "copy",
  cut: "cut",
  paste: "paste",
  // scrolling and media
  scroll: "scroll",
  scrollend: "scrollEnd",
  load: "load",
  error: "error",
  // animation
  animationstart: "animationStart",
  animationend: "animationEnd",
  animationiteration: "animationIteration",
  transitionstart: "transitionStart",
  transitionend: "transitionEnd",
  transitioncancel: "transitionCancel",
});

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
  constructor(controller) {
    /** Whose properties bindings read; a drawn view answers for itself. */
    this.controller = controller ?? this;
    /** The root DOM node, set once the tree is rendered. */
    this.node = null;
    /** Props from the last draw, replayed on redraw. */
    this.props = {};
    /** Every top-level node this view put in the document. */
    this.nodes = [];
    /** Listeners this component attached, per node, so they can be moved. */
    this.listeners = new Map();
    /** Settings assigned through `set()`, taking precedence over props. */
    this.overrides = {};
    /** Whether `attached()` has been called and `detached()` has not. */
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
   */

  /**
   * A setting's current value: an override once one has been assigned — even
   * `null`, which is how a caller clears one — then the prop, then the default.
   *
   * A method named `get`, not a getter — `get(a, b)` in a class body declares
   * one, since a getter takes a name and no parameters.
   *
   *   get text() { return this.get("text", ""); }
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
   */
  set(name, value) {
    this.overrides[name] = value;
    this.needsDisplay();
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
    const targets = this.nodes.filter((n) => typeof n?.addEventListener === "function");

    for (const [node, attached] of this.listeners) {
      if (targets.includes(node)) continue;
      for (const type in attached) node.removeEventListener(type, attached[type]);
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
   * `h()` calls — instead of writing a `.mib` file:
   *
   *   class Counter extends Component {
   *     draw() {
   *       return <View styleName="counter">{this.count}</View>;
   *     }
   *   }
   *
   * `draw` is optional: a view backed by a `.mib` component leaves it undefined.
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
      for (const type in attached) node.removeEventListener(type, attached[type]);
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
   * replaces its nodes; a `.mib`-backed view re-reads its `{path}` bindings.
   * Either way it applies immediately.
   *
   * Rarely needed: a property a `{path}` binds to, or that `draw()` reads, is
   * observed, so assigning to it already does this. What observation cannot
   * see is a change that assigns nothing — mutating an object or an array in
   * place, `this.items.push(x)` — and that is what this is for.
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
