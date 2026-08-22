// Switch, ported from GWT Mosaic (client/components/Switch.java + its
// Switch.ui.xml template). It sits beside CheckBox because it is the same
// control worn differently: a checkbox whose indicator is a track with a knob
// that slides, and whose stylesheet ships in the same place.
//
// The Java version adds and removes a `checked` class on the root and lets the
// stylesheet move the knob; here `draw()` states the class for the current
// value and the runtime patches the DOM to match.
import ToggleControl from "../ToggleControl.js";
import "./switch.css";

const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

export default class Switch extends ToggleControl {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Switch`. See Component.styleName.
   */
  static styleName = "v-Switch";

  // --- value ---------------------------------------------------------------

  /** On or off. */
  get value() {
    return this.get("value", false);
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Set the value, and say whether that counts as the user flipping it.
   *
   * `setValue(v, true)` fires the action; assigning to `value` does not,
   * which is what lets an owner put the switch into a state without hearing
   * about its own assignment.
   */
  setValue(value, fireEvents = false) {
    const next = this.bool(value);
    if (this.value === next) return;

    this.set("value", next);
    if (fireEvents) this.fireAction(next);
  }

  /** Flip it, as a click or an activation key does. */
  toggle() {
    this.setValue(!this.value, true);
  }

  // --- behaviour -----------------------------------------------------------
  // Each method is named after the DOM event it handles, so the base class
  // binds it automatically; the markup declares no handlers.

  /** The primary button must not start a selection — onPointerDown. */
  pointerDown(event) {
    if (event.button === undefined || event.button === 0)
      event.preventDefault?.();
  }

  click() {
    if (!this.enabled) return;
    this.toggle();
  }

  keyDown(event) {
    // The Java version omits this check, so a disabled switch there can
    // still be flipped by a key. A disabled control does nothing here.
    if (!this.enabled) return;
    if (!ACTIVATION_KEYS.has(event.key)) return;
    event.preventDefault?.();
    this.toggle();
  }

  // --- drawing -------------------------------------------------------------

  draw() {
    const on = this.value;

    // The track is the indicator and the knob is drawn by the stylesheet,
    // so the state lives on the root: `.v-Switch.checked` slides it.
    return (
      <div
        {...this.controlProps()}
        styleName={[
          "v-Switch",
          on ? "checked" : null,
          ...this.controlClasses(),
        ]}
        role="checkbox"
        aria-checked={String(on)}
        aria-labelledby={this.labelId}
      >
        <div styleName="indicator" />
        <span id={this.labelId}>{this.text}</span>
      </div>
    );
  }
}
