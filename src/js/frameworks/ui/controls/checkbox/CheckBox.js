// CheckBox, ported from GWT Mosaic (client/components/CheckBox.java + its
// CheckBox.ui.xml template). The Java version builds the DOM once with
// UiBinder and then adds and removes the `checked` class through setValue();
// here `draw()` states the markup for the current value and `needsDisplay()`
// patches the DOM to match.
//
// It is a checkbox the way the Java one is: a focusable `div` with
// `role="checkbox"`, not an `<input type="checkbox">`. The indicator and its
// check mark are drawn by the stylesheet, so they can be themed.
import ToggleControl from "../ToggleControl.js";
import "./checkbox.css";

const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

export default class CheckBox extends ToggleControl {
    // --- value ---------------------------------------------------------------

    /** Checked or not. `HasValue<Boolean>` in Java. */
    get value() {
        return this.get("value", false);
    }

    set value(value) {
        this.setValue(value, false);
    }

    /**
     * Set the value, and say whether that counts as the user changing it.
     *
     * `setValue(v, true)` fires the action, as ValueChangeEvent + ActionEvent
     * do in Java; assigning to `value` does not, which is what lets an owner
     * put the control into a state without hearing about its own assignment.
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

    /** Pointer down must not move focus or start a selection — onPointerDown. */
    pointerDown(event) {
        event.preventDefault?.();
    }

    click() {
        if (!this.enabled) return;
        this.toggle();
    }

    keyDown(event) {
        if (!this.enabled) return;
        if (!ACTIVATION_KEYS.has(event.key)) return;
        event.preventDefault?.();
        this.toggle();
    }

    // --- drawing -------------------------------------------------------------

    draw() {
        const checked = this.value;

        return (
            <div
                {...this.controlProps()}
                styleName={["v-CheckBox", ...this.controlClasses()]}
                role="checkbox"
                aria-checked={String(checked)}
                aria-labelledby={this.labelId}
            >
                <span id={this.labelId}>{this.text}</span>
                <div styleName={["indicator", checked ? "checked" : null]}>
                    <div styleName={["check", checked ? "checked" : null]}/>
                </div>
            </div>
        );
    }
}
