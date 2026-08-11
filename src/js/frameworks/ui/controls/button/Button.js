// Button, ported from GWT Mosaic (client/components/Button.java + its
// Button.ui.xml template). The Java version mutates a UiBinder-built DOM
// through setters; here `draw()` states the markup for the current state and
// `needsDisplay()` patches the DOM to match.
import Control from "../Control.js";
import "./button.css";

/** Visual intent, matching Intent.java (lower-cased, as its toString() does). */
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
export const ButtonState = Object.freeze({ON: "on", OFF: "off"});

const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

export default class Button extends Control {
    constructor() {
        super();
        this.buttonState = ButtonState.OFF;
    }

    // --- configuration -------------------------------------------------------
    // Java exposes getText/setText and friends; these are the same API in the
    // shape JavaScript expects, and each setter repaints.

    get text() {
        return this.get("text", "");
    }

    set text(value) {
        this.set("text", value);
    }

    get intent() {
        return this.get("intent", Intent.DEFAULT);
    }

    set intent(value) {
        this.set("intent", value || Intent.DEFAULT);
    }

    /** A font-icon class name, e.g. "fa-check". */
    get icon() {
        return this.get("icon", null);
    }

    set icon(value) {
        this.set("icon", value);
    }

    /** An image URL or data: URI, drawn in the icon slot instead of a font icon. */
    get iconImage() {
        return this.get("iconImage", null);
    }

    set iconImage(value) {
        this.set("iconImage", value);
    }

    get iconOnly() {
        return this.get("iconOnly", false);
    }

    set iconOnly(value) {
        this.set("iconOnly", !!value);
    }

    get toggle() {
        return this.get("toggle", false);
    }

    set toggle(value) {
        this.set("toggle", !!value);
    }

    get type() {
        return this.get("type", "button");
    }

    set type(value) {
        this.set("type", value);
    }

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
     * The getter has to be redeclared alongside the setter — a class that
     * defines only one half of an accessor shadows the inherited other half,
     * and reads would come back undefined.
     */
    get enabled() {
        return super.enabled;
    }

    set enabled(value) {
        if (!value) this.buttonState = ButtonState.OFF;
        super.enabled = value;
    }

    /** `ButtonState.ON` while pressed, or while latched on for a toggle. */
    get on() {
        return this.buttonState === ButtonState.ON;
    }

    set on(value) {
        this.setButtonState(value ? ButtonState.ON : ButtonState.OFF);
    }

    setButtonState(state) {
        if (this.buttonState === state) return;
        this.buttonState = state;
        this.needsDisplay();
    }

    // --- behaviour -----------------------------------------------------------
    // Each method is named after the DOM event it handles, so the base class
    // binds it automatically; the markup declares no handlers.

    pointerDown(event) {
        if (!this.enabled) {
            event.preventDefault?.();
            return;
        }
        // Primary button only; `button` is 0 for the primary pointer.
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault?.();

        if (this.toggle) {
            this.setButtonState(this.on ? ButtonState.OFF : ButtonState.ON);
            this.fireAction();
        } else {
            this.setButtonState(ButtonState.ON);
        }
    }

    pointerUp() {
        if (!this.toggle) this.setButtonState(ButtonState.OFF);
    }

    pointerLeave() {
        if (!this.toggle) this.setButtonState(ButtonState.OFF);
    }

    blur() {
        if (!this.toggle) this.setButtonState(ButtonState.OFF);
    }

    keyDown(event) {
        if (!this.enabled) return;
        if (!ACTIVATION_KEYS.has(event.key)) return;
        event.preventDefault?.();

        if (this.toggle) {
            this.setButtonState(this.on ? ButtonState.OFF : ButtonState.ON);
            this.fireAction();
        } else {
            this.setButtonState(ButtonState.ON);
        }
    }

    keyUp() {
        if (!this.toggle) this.setButtonState(ButtonState.OFF);
    }

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

    draw() {
        const hasIcon = !!(this.icon || this.iconImage);

        // The class list the Java version maintains through add/removeStyleName.
        const classes = [
            "v-Button",
            this.intent,
            hasIcon ? null : "noIcon",
            this.iconOnly ? "iconOnly" : null,
            this.toggle ? "toggle" : null,
            this.on ? "is-active" : null,
            ...this.controlClasses(),
        ];

        return (
            <button
                {...this.controlProps()}
                styleName={classes}
                type={this.type}
                title={this.tooltip}
                aria-pressed={this.toggle ? String(this.on) : null}
            >
                <div>
                    {hasIcon ? this.drawIcon() : null}
                    {this.iconOnly ? null : <span styleName="label">{this.text}</span>}
                </div>
            </button>
        );
    }

    drawIcon() {
        if (this.iconImage) {
            // setIconBase64() in Java: the image is painted as the icon's background.
            return (
                <i
                    styleName="icon"
                    style={{
                        backgroundImage: `url(${this.iconImage})`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center",
                        backgroundSize: "100%",
                        width: "30px",
                    }}
                />
            );
        }
        return <span styleName={["icon", this.icon]}/>;
    }
}
