// Control, ported from GWT Mosaic (client/components/Control.java and the
// IControl defaults it implements). A control is a focusable component that
// can be enabled or disabled and that fires an action.
//
// Java mutates the element through setters; here the state lives on the
// component and `controlProps()` / `controlClasses()` feed it into `draw()`.
import {Component} from "../../runtime/mosaic.js";

export default class Control extends Component {
  // `get()` and `set()` come from Component.

  // --- enablement ----------------------------------------------------------

  get enabled() {
    return this.get("enabled", true);
  }

  /**
   * Disabling drops focus and takes the control out of the tab order, as
   * IControl.setEnabled does.
   */
  set enabled(value) {
    const enabled = !!value;
    this.overrides.enabled = enabled;
    if (!enabled) this.setFocus(false);
    this.needsDisplay();
  }

  // --- identity and accessibility -----------------------------------------

  get name() {
    return this.get("name", null);
  }
  set name(value) {
    this.set("name", value);
  }

  get controlId() {
    return this.get("controlId", null);
  }
  set controlId(value) {
    this.set("controlId", value);
  }

  /** 0 when enabled, -1 when not, unless something set it explicitly. */
  get tabIndex() {
    return this.get("tabIndex", this.enabled ? 0 : -1);
  }
  set tabIndex(value) {
    this.set("tabIndex", value);
  }

  // --- focus ---------------------------------------------------------------

  /**
   * Move focus to this control, or away from it — `setFocus(false)` blurs.
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
    this.props.action?.(this, ...args);
  }

  // --- drawing helpers -----------------------------------------------------

  /** Classes every control carries; spread these into the root's class list. */
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
