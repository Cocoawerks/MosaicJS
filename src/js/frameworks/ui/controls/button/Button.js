// Button: a clickable command control. `draw()` states the markup for the
// current state and `needsDisplay()` patches the DOM to match. A toggle button
// latches on and off each time it is pressed; otherwise a press fires its action.
import Control from "../Control.js";
import "./button.css";

/** Visual intent, matching Intent.java (lower-cased, as its toString() does). */
/** Visual intent (lower-cased, as its toString() does). */
export const Intent = Object.freeze({
  DEFAULT: "default",
  PRIMARY: "primary",
  DANGER: "danger",
  SUCCESS: "success",
  WARNING: "warning",
  INFO: "info",
  INVERSE: "inverse",
});

/** Latched state of a toggle button, matching ButtonState.java. */
/** Latched state of a toggle button. */
export const ButtonState = Object.freeze({ ON: "on", OFF: "off" });

const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

/**
 * @fires Button#click — pressed or activated from the keyboard; the handler is
 *   given the button. Its sole action, so it binds bare: `action="method"`
 *   (`onClick` in JS). A toggle button fires it each time it latches on or off.
 */
export default class Button extends Control {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Button`. See Component.styleName.
   */
  static styleName = "v-Button";

  static props = {
    /** Button text */
    text: { type: String, default: "" },
    intent: { type: String, default: Intent.DEFAULT },
    icon: { type: String },
    /** An image URL or data: URI, drawn in the icon slot instead. */
    iconImage: { type: String },
    /** Whether the label is dropped and only the icon shown. */
    iconOnly: { type: Boolean, default: false },
    /** Whether the button latches on and off rather than firing once. */
    toggle: { type: Boolean, default: false },
    /** The `type` attribute the button carries. */
    type: { type: String, default: "button" },
  };

  /**
   * Shown as the native `title`. The Java version can also render a styled
   * popover; that needs the Tooltip component, which is not ported yet.
   */
  get tooltip() {
    return this.get("tooltip", null);
  }

  set tooltip(value) {
    this.set("tooltip", value || null);
  }

  /**
   * As Control, plus: a disabled button cannot stay pressed.
   *
   * The getter has to be redeclared alongside the setter — a class that defines
   * only one half of an accessor shadows the inherited other half, and reads
   * would come back undefined.
   */
  get enabled() {
    return super.enabled;
  }

  set enabled(value) {
    if (!value) this.buttonState = ButtonState.OFF;
    super.enabled = value;
  }

  /**
   * `ButtonState.ON` while pressed, or while latched on for a toggle, and
   * `ButtonState.OFF` otherwise.
   *
   * The state itself, rather than a boolean beside it: there were two ways to
   * ask the same question — `on` and `buttonState` — and a subclass wanting to
   * hear about latching had to override a method and trust that nothing
   * assigned the field behind it.
   *
   * A setter rather than `setButtonState`, so it is assigned like any other
   * setting on a control: `button.buttonState = ButtonState.OFF`. A subclass
   * that acts on the change overrides the setter and calls `super`, which is
   * how MenuButton and MenuBarItem show and hide their menus.
   */
  get buttonState() {
    return this.get("buttonState", ButtonState.OFF);
  }

  set buttonState(value) {
    if (this.buttonState === value) return;
    // `set` repaints and tells whatever is watching, so there is nothing to do
    // here that assigning a setting does not already do.
    this.set("buttonState", value);
  }

  // --- behaviour -----------------------------------------------------------
  // Each method is named after the DOM event it handles, so the base class
  // binds it automatically; the markup declares no handlers.

  /** @internal **/
  pointerDown(event) {
    if (!this.enabled) {
      event.preventDefault?.();
      return;
    }
    // Primary button only; `button` is 0 for the primary pointer.
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();

    if (this.toggle) {
      this.buttonState =
        this.buttonState === ButtonState.ON ? ButtonState.OFF : ButtonState.ON;
      this.fireAction();
    } else {
      this.buttonState = ButtonState.ON;
    }
  }

  /** @internal **/
  pointerUp() {
    if (!this.toggle) this.buttonState = ButtonState.OFF;
  }

  /** @internal **/
  pointerLeave() {
    if (!this.toggle) this.buttonState = ButtonState.OFF;
  }

  /** @internal **/
  blur() {
    if (!this.toggle) this.buttonState = ButtonState.OFF;
  }

  /**
   * Enter or Space going down: the button takes its pressed face.
   *
    @internal
   */
  keyDown(event) {
    if (!this.enabled) return;
    if (!ACTIVATION_KEYS.has(event.key)) return;

    if (this.toggle) {
      this.buttonState =
        this.buttonState === ButtonState.ON ? ButtonState.OFF : ButtonState.ON;
      this.fireAction();
    } else {
      this.buttonState = ButtonState.ON;
    }
  }

  /** @internal **/
  keyUp() {
    if (!this.toggle) this.buttonState = ButtonState.OFF;
  }

  /** @internal **/
  click(event) {
    if (!this.enabled) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    // A toggle already fired on pointer/key down, when its state flipped.
    if (!this.toggle) this.fireAction();
  }

  // --- drawing -------------------------------------------------------------

  /** Whether anything is drawn in the icon slot. */
  get hasIcon() {
    return !!(this.icon || this.iconImage);
  }

  /**
    @internal
   */
  buttonClasses() {
    return [
      "v-Button",
      this.intent,
      this.hasIcon ? null : "noIcon",
      this.iconOnly ? "iconOnly" : null,
      this.toggle ? "toggle" : null,
      this.buttonState === ButtonState.ON ? "is-active" : null,
      ...this.controlClasses(),
    ];
  }

  /**
   @internal
   */
  drawSuffix() {
    return null;
  }

  /** @internal **/
  draw() {
    return (
      <button
        {...this.controlProps()}
        styleName={this.buttonClasses()}
        type={this.type}
        title={this.tooltip}
        aria-pressed={this.toggle ? String(this.buttonState === ButtonState.ON) : null}
      >
        <div>
          {this.hasIcon ? this.drawIcon() : null}
          {this.iconOnly ? null : <span styleName="label">{this.text}</span>}
          {this.drawSuffix()}
        </div>
      </button>
    );
  }

  /** @internal **/
  drawIcon() {
    if (this.iconImage) {
      // setIconBase64() in Java: the image is painted as the icon's
      // plain button alike. The Java version wrote a 30px width inline
      // background. Only the picture is named here
      // instead, which no sheet could then correct: in a toolbar it made this
      // one icon wider than its neighbours and drew it past the 24px slot.
      return (
        <i
          styleName={["icon", "iconImage"]}
          style={{ backgroundImage: `url(${this.iconImage})` }}
        />
      );
    }

    if (typeof this.icon === "function") {
      const Icon = this.icon;
      return (
        <i styleName="icon">
          <Icon aria-hidden="true" />
        </i>
      );
    }
    return <span styleName={["icon", this.icon]} />;
  }
}
