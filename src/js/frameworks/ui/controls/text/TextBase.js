// TextBase, ported from GWT Mosaic (client/components/TextBase.java): what
// every text control has in common — the input it wraps, the value it carries,
// and how it reports being typed in.
//
// A field reports twice over, and the two mean different things:
//
//   `action="change:edited"`   every keystroke, while the field is continuous
//   `action="submitted"`       Enter, which is the user saying they are done
//
// The box and the input are drawn here rather than in each subclass, and for a
// reason worth knowing: a stylesheet is scoped to the module that imports it,
// so the elements `text.css` styles have to be drawn by the module that
// imports it too. Subclasses fill the slots on either side of the input and
// say what the box is called.
import Control from "../Control.js";
import "./text.css";

export default class TextBase extends Control {
  static props = {
    /** Whether the browser may complete the field. */
    autocomplete: { type: Boolean, default: false },
    /** Whether every keystroke is reported, or only Enter and leaving. */
    continuous: { type: Boolean, default: true },
    /** A font-icon class drawn before the text. */
    prefixIcon: { type: String },
    /** A font-icon class drawn after it. */
    suffixIcon: { type: String },
    /** Whether the field must be filled in. */
    required: { type: Boolean, default: false },
  };

    // --- value ---------------------------------------------------------------

    /**
     * What the field holds. Once it is on screen the input is the truth: the
     * user types into it without anything here being told.
     */
    get value() {
        return this.inputLayer ? this.inputLayer.value : this.get("value", "");
    }

    set value(value) {
        this.setValue(value, false);
    }

    /**
     * Set the value, and say whether that counts as the user changing it.
     * `setValue(v, true)` reports the change; assigning to `value` does not.
     */
    setValue(value, fireEvents = false) {
        const next = value ?? "";
        if (this.value === next) return;

        this.set("value", next);
        if (this.inputLayer) this.inputLayer.value = next;
        if (fireEvents) this.fireChange(next);
    }

    /** Whether the field is empty but for whitespace. */
    get blank() {
        return this.value.trim() === "";
    }

    // --- configuration -------------------------------------------------------

    get placeholder() {
        return this.get("placeholder", null);
    }

    set placeholder(value) {
        this.set("placeholder", value || null);
    }

    bindEvents() {
        super.bindEvents();

        // Wrapped rather than passed: a method handed to addEventListener is
        // called with the input as `this`, and what these have to reach is the
        // control.
        const attached = {
            focus: () => this.focus(),
            blur: () => this.blur(),
        };

        for (const type in attached) {
            this.inputLayer.addEventListener(type, attached[type]);
        }

        this.listeners.set(this.inputLayer, attached);
    }
    
    // --- focus ---------------------------------------------------------------

    /**
     * Focus belongs to the input, not to the box drawn around it — but the ring
     * is the box's, so the box has to be told.
     *
     * A disabled field takes no focus and wears no ring. That matters here more
     * than it looks: disabling a control is itself a `setFocus(false)`, which is
     * how a field that was never focused ended up lit the moment it was
     * disabled.
     */
    setFocus(focused) {
        if (!this.inputLayer) return;

        const takesFocus = focused && this.enabled;
        if (takesFocus) this.inputLayer.focus?.();
        else this.inputLayer.blur?.();

        this.set("isFocused", takesFocus);
    }

    get focused() {
        return (
            !!this.inputLayer &&
            this.inputLayer === this.inputLayer.ownerDocument?.activeElement
        );
    }

    /** Select what the field holds, as `selectAll()` does. */
    selectAll() {
        this.inputLayer?.select?.();
    }

    // --- behaviour -----------------------------------------------------------
    // Each method is named after the DOM event it handles, so the base class
    // binds it automatically.

    focus() {
        if (!this.enabled) return;
        this.set("isFocused", true);

    }

    blur() {
        this.set("isFocused", false);
    }

    /**
     * A keystroke. The input holds the new value; this passes it on, and only
     * while the field is continuous — a field that is not reports on Enter and
     * on leaving, as `setContinuous(false)` arranges.
     */
    input() {
        if (!this.enabled || !this.continuous) return;
        this.set("value", this.inputLayer ? this.inputLayer.value : "");
        this.fireChange(this.value);
    }

    /** The input settled: what the browser calls a change. */
    change() {
        if (!this.enabled) return;
        this.set("value", this.inputLayer ? this.inputLayer.value : "");
        if (!this.continuous) this.fireChange(this.value);
    }

    keyPress(event) {
        if (!this.enabled) return;
        if (event.key !== "Enter") return;
        // Enter is the user saying they are done, which is the action.
        this.fireChange(this.value);
        this.fireAction(this.value);
    }

    /** Report a new value to whoever asked for `action="change:method"`. */
    fireChange(value) {
        const control = this.self;
        control.props.changeAction?.(control, value);
    }

    // --- drawing -------------------------------------------------------------

    /** What the box is, for a screen reader. */
    get role() {
        return "textbox";
    }

    /**
     * The classes the box carries. A subclass adds its own name to these.
     *
     * The ring is conditioned on being enabled as well as focused, so a field
     * disabled by a prop — which never passes through the `enabled` setter —
     * cannot be left wearing one either.
     */
    boxClasses() {
        return [
            "v-Text",
            this.get("isFocused", false) && this.enabled ? "is-focused" : null,
            ...this.controlClasses(),
        ];
    }

    /**
     * What sits before the text, and after it: the two icon slots the GWT
     * template always emits, empty or not — `.v-Text .icon` gives them the
     * margin that holds the text off the box's edge, so a field without them
     * runs its text into the border.
     *
     * They are drawn here rather than in TextField because `.v-Text .icon` is
     * a rule of this module's stylesheet: a sheet is scoped to the module that
     * imports it, and a slot drawn in a subclass carries that subclass's scope
     * instead, which no rule here can reach.
     *
     * A subclass that puts something else at either end — SearchField's
     * magnifier and its reset button — overrides these and brings its own.
     */
    drawPrefix() {
        return <i styleName={["icon", "prefix", this.prefixIcon]}/>;
    }

    drawSuffix() {
        return <i styleName={["icon", "suffix", this.suffixIcon]}/>;
    }

    /** Anything the input itself carries beyond `inputProps()`. */
    inputExtras() {
        return {};
    }

    draw() {
        return (
            <div styleName={this.boxClasses()} role={this.role}>
                <div>
                    {this.drawPrefix()}
                    <input
                        {...this.inputProps()}
                        {...this.inputExtras()}
                        styleName="v-Text-input"
                    />
                    {this.drawSuffix()}
                </div>
            </div>
        );
    }

    /**
     * The attributes the input itself carries. The control's own attributes go
     * here rather than on the box: the input is what takes focus and what a
     * form reads.
     */
    inputProps() {
        return {
            ...this.controlProps(),
            ref: (el) => (this.inputLayer = el),
            value: this.get("value", null),
            placeholder: this.placeholder,
            required: this.required ? "required" : null,
            disabled: this.enabled ? null : "disabled",
            autocomplete: this.autocomplete ? "on" : "off",
        };
    }
}
