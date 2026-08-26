// Control: the base of the focusable components — one that can be enabled or
// disabled and that fires an action. The state lives on the component, and
// `controlProps()` / `controlClasses()` feed it into `draw()`.
import { Component } from "mosaic";

export default class Control extends Component {
  constructor(props) {
    super(props);
  }

  static props = {
    /** @public The id the control's focusable element carries.
     * Used for referencing the underlying <input>:
     *
     * <label for="the-control-id> </label>
     *
     * <TextField controlId="the-control-id" />
     * */
    controlId: { type: String },
    /** @public The control's name, as a form reads it. */
    name: { type: String },
  };


  // --- enablement ----------------------------------------------------------

  /**
   * @public Whether the control can be operated. A disabled control drops
   * focus and leaves the tab order.
   */
  get enabled() {
    return this.get("enabled", true);
  }

  set enabled(value) {
    const enabled = this.bool(value);
    this.overrides.enabled = enabled;
    if (!enabled) this.setFocus(false);
    this.needsDisplay();
  }

  // --- identity and accessibility -----------------------------------------

  /** @public 0 when enabled, -1 when not, unless something set it explicitly. */
  get tabIndex() {
    return this.get("tabIndex", this.enabled ? 0 : -1);
  }

  set tabIndex(value) {
    this.set("tabIndex", value);
  }

  // --- focus ---------------------------------------------------------------

  /**
   * @public Move focus to this control, or away from it — `setFocus(false)`
   * blurs.
   *
   * Named after Java's setFocus rather than `focus()`/`blur()` on purpose:
   * those names belong to the event handlers a component may implement, so
   * defining them here would bind this method as a focus listener and call
   * itself.
   */
  setFocus(focused) {
    const node = this.node;
    if (!node) return;
    if (focused) node.focus?.();
    else node.blur?.();
  }

  /** @public True if this control currently holds the keyboard focus. */
  get focused() {
    return !!this.node && this.node === this.node.ownerDocument?.activeElement;
  }

  // --- action --------------------------------------------------------------

  /**
   * Fire the control's action. The owner binds a method to it in markup:
   *
   *   <Button text="Save" action="save" />
   *
   * which the compiler passes down as the `action` prop.
   */
  fireAction(...args) {
    // `self` rather than `this`: a handler set up while drawing holds the
    // proxy the drawing ran against, and what fires should be the control.
    const control = this.self;
    control.props.action?.(control, ...args);
  }

  // --- drawing helpers -----------------------------------------------------

  /** Classes every control carries; spread these into the root's class list. @internal */
  controlClasses() {
    return [this.enabled ? null : "is-disabled"];
  }

  /**
   * Attributes every control carries. Spread onto the root element in `draw()`:
   *
   *   <button {...this.controlProps()}>…</button>
   *
   * `null` values are dropped by the runtime, so unset settings add nothing.
   */
  controlProps() {
    return {
      tabindex: String(this.tabIndex),
      name: this.name,
      id: this.controlId,
      "aria-disabled": this.enabled ? null : "true",
    };
  }
}
