// SpinButton, ported from GWT Mosaic (client/components/SpinButton.java): a
// SpinButton: a
// number in a field with a step down and a step up beside it.
//   <SpinButton minValue="0" maxValue="10" value="3" outlet="quantity"
//               action="quantityChanged"/>
// The two buttons and the field are components of their own, composed here.
// Typing is settled after a pause rather than on every keystroke: a field being
// typed into passes through states that are not numbers, and a half-typed "1"
// on the way to "12" should not snap the value to 1 and take the caret with it.
import { Component } from "mosaic";

import Button from "../button/Button.js";
import TextField from "../text/TextField.js";
import Minus from "svg:minus";
import Plus from "svg:plus";
import "./spinbutton.css";

/** How long typing settles before it is taken as the value, in milliseconds. */
const TYPING_DELAY = 600;

/** How long a held button waits before it starts repeating, and how fast. */
const REPEAT_DELAY = 400;
const REPEAT_PERIOD = 100;

/**
 * @fires SpinButton#valueChanged — the value changed; the handler is given the
 *   spin button and the new value. Bound bare: `action="method"`
 *   (`onValueChanged` in JS).
 */
export default class SpinButton extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `SpinButton`. See Component.styleName.
   */
  static styleName = "v-SpinButton";

  static props = {
    /** Whether the control can be worked. */
    enabled: { type: Boolean, default: true },
    /** The lowest number it will take. */
    minValue: { type: Number, default: 0 },
    /** The highest. */
    maxValue: { type: Number, default: 100 },
    /** How far one press of a step button moves the number. */
    step: { type: Number, default: 1 },
  };

  constructor(props) {
    super(props);
    this.typingTimer = null;
    this.repeatTimer = null;
  }

  // --- value ---------------------------------------------------------------

  get value() {
    return this.constrain(Number(this.get("value", 0)));
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Set the number, and say whether that counts as the user setting it.
   *
   * @param {number} value The number wanted.
   * @param {boolean} [fireEvents] Whether to report it.
   */
  setValue(value, fireEvents = false) {
    const next = this.constrain(Number(value));
    if (!Number.isFinite(next) || next === this.value) return;

    this.set("value", next);
    if (fireEvents) this.props.action?.(this.self, next);
  }

  constrain(value) {
    return Math.min(this.maxValue, Math.max(this.minValue, value));
  }

  /**
   * Step the value one way or the other.
   *
   * A step of nothing is read as a step of one — a spin button whose buttons
   * do nothing is not what `step="0"` can have meant — which is where the
   * slider guards it too.
   */
  spin(direction) {
    this.setValue(this.value + direction * (this.step || 1), true);
  }

  // --- behaviour -------------------------------------------------------------

  /**
   * A button held down keeps stepping. The first step is the press itself, so
   * the repeat waits before starting — otherwise a plain click steps twice.
   */
  startRepeating(direction) {
    this.stopRepeating();
    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = setInterval(() => this.spin(direction), REPEAT_PERIOD);
    }, REPEAT_DELAY);
  }

  stopRepeating() {
    if (this.repeatTimer === null) return;
    clearTimeout(this.repeatTimer);
    clearInterval(this.repeatTimer);
    this.repeatTimer = null;
  }

  /**
   * The field was typed into. What is there may not be a number yet, so it is
   * given a moment to become one; if it never does, the field is put back to
   * the value the control still holds.
   */
  typed(field, text) {
    if (this.typingTimer !== null) clearTimeout(this.typingTimer);

    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      const typed = Number.parseInt(text, 10);
      if (Number.isNaN(typed)) {
        field.value = String(this.value);
        return;
      }
      this.setValue(typed, true);
      // Held to the bounds, and the field says what was actually taken.
      field.value = String(this.value);
    }, TYPING_DELAY);
  }

  keyDown(event) {
    if (!this.enabled) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault?.();
    this.spin(event.key === "ArrowUp" ? 1 : -1);
  }

  focusIn() {
    if (!this.enabled) return;
    this.set("isFocused", true);
  }

  focusOut() {
    this.set("isFocused", false);
  }

  /** Nothing held down survives the control going away. */
  destroy() {
    this.stopRepeating();
    if (this.typingTimer !== null) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    super.destroy();
  }

  // --- drawing -------------------------------------------------------------

  /**
   * A step button. It is out of the tab order — the field is the one tab stop,
   * and the arrow keys are what step from the keyboard.
   */
  drawStepButton(direction, icon, label) {
    const canStep =
      this.enabled &&
      (direction > 0 ? this.value < this.maxValue : this.value > this.minValue);

    // The wrapper carries `up` or `down` because `styleName` on a component
    // names a prop rather than a class on what it draws, so the sheet needs
    // something this module drew to hang those off.
    //
    // It carries the click too, rather than the button taking an `action`:
    // `action` in markup names a method on the controller, and what is wanted
    // here is a step. Nothing is lost by listening a level out — a disabled
    // Button stops a click from going any further, so a step that cannot be
    // taken never reaches this.
    return (
      <div
        styleName={direction > 0 ? "up" : "down"}
        onclick={() => canStep && this.spin(direction)}
        onpointerdown={() => canStep && this.startRepeating(direction)}
        onpointerup={() => this.stopRepeating()}
        onpointerleave={() => this.stopRepeating()}
      >
        <Button
          iconOnly
          enabled={canStep}
          tabindex="-1"
          aria-label={label}
          icon={icon}
        />
      </div>
    );
  }

  draw() {
    const enabled = this.enabled;
    return (
      <div
        styleName={[
          "v-SpinButton",
          enabled ? null : "is-disabled",
          this.get("isFocused", false) && enabled ? "is-focused" : null,
        ]}
        role="spinbutton"
        aria-valuemin={String(this.minValue)}
        aria-valuemax={String(this.maxValue)}
        aria-valuenow={String(this.value)}
        aria-disabled={enabled ? null : "true"}
      >
        <div>
          <div styleName="v-SpinButton-Text">
            <TextField
              value={String(this.value)}
              enabled={enabled}
              ref={(field) => (this.field = field)}
              changeAction={(field, text) => this.typed(field, text)}
            />
          </div>
          <div styleName="SpinButton-btns">
            {this.drawStepButton(-1, Minus, "Step down")}
            {this.drawStepButton(1, Plus, "Step up")}
          </div>
        </div>
      </div>
    );
  }
}
