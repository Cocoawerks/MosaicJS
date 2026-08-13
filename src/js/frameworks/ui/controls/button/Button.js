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
    // Java exposes getText/setText and friends; declared here instead, which is
    // the same API in the shape JavaScript expects. Only the settings whose
    // assignment does something beyond storing it are written out below.

    static props = {
        /** What the button reads. */
        text: {type: String, default: ""},
        /** One of Intent, which decides the face it wears. */
        intent: {type: String, default: Intent.DEFAULT},
        /** A font-icon class name, e.g. "fa-check", or an icon component. */
        icon: {type: String},
        /** An image URL or data: URI, drawn in the icon slot instead. */
        iconImage: {type: String},
        /** Whether the label is dropped and only the icon shown. */
        iconOnly: {type: Boolean, default: false},
        /** Whether the button latches on and off rather than firing once. */
        toggle: {type: Boolean, default: false},
        /** The `type` attribute the button carries. */
        type: {type: String, default: "button"},
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

    /** Whether anything is drawn in the icon slot. */
    get hasIcon() {
        return !!(this.icon || this.iconImage);
    }

    /**
     * The class list the Java version maintains through add/removeStyleName.
     * A subclass that changes what the button is adds to this.
     */
    buttonClasses() {
        return [
            "v-Button",
            this.intent,
            this.hasIcon ? null : "noIcon",
            this.iconOnly ? "iconOnly" : null,
            this.toggle ? "toggle" : null,
            this.on ? "is-active" : null,
            ...this.controlClasses(),
        ];
    }

    draw() {
        return (
            <button
                {...this.controlProps()}
                styleName={this.buttonClasses()}
                type={this.type}
                title={this.tooltip}
                aria-pressed={this.toggle ? String(this.on) : null}
            >
                <div>
                    {this.hasIcon ? this.drawIcon() : null}
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
        // An icon may be a component rather than a class — a compiled `svg:` icon
        // is a function returning a vnode — which is what `setIcon(Widget)` takes
        // in Java. Drawn inside the slot, so the sheet still finds `.icon`.
        if (typeof this.icon === "function") {
            const Icon = this.icon;
            return (
                <i styleName="icon">
                    <Icon aria-hidden="true"/>
                </i>
            );
        }
        return <span styleName={["icon", this.icon]}/>;
    }
}
