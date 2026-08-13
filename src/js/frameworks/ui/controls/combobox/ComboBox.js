// ComboBox, ported from GWT Mosaic (client/components/ComboBox.java + its
// ComboBox.ui.xml template): a native `<select>` in a framed box, with a
// chevron drawn beside it.
//
// The native control is the point — it brings the platform's own list, its
// keyboard handling and its accessibility with it. What the component adds is
// the frame, the chevron and the theme.
//
// Java takes its entries as child `Option` widgets appended to the select.
// Here they are child components, or an `options` list for code that would
// rather pass data:
//
//   <ComboBox outlet="colour" action="colourChanged">
//       <Option text="Red" value="red"/>
//   </ComboBox>
//
//   <ComboBox options={["Red", "Green"]} value="Red" action="colourChanged"/>
import Control from "../Control.js";
import Option from "./Option.js";
import "./combobox.css";

// The chevron, resolved at compile time out of the framework's icons — what
// SvgIconLibrary.getIcon("svg:chevron-down") hands the Java version.
import ChevronDown from "svg:chevron-down";

export default class ComboBox extends Control {
    // --- entries -------------------------------------------------------------

    /**
     * The entries, when they are given as data rather than as child `Option`s:
     * a list of strings, or of `{text, value, enabled}`. Children win — they
     * are what the markup states.
     */
    get options() {
        return this.get("options", []);
    }

    set options(value) {
        this.set("options", value ?? []);
    }

    // --- value ---------------------------------------------------------------

    /** The value of the chosen entry. `HasValue<String>` in Java. */
    get value() {
        // Once it is on screen the select is the truth: the user can change it
        // without anything here being told, exactly as in the Java version,
        // which reads controlLayer.getValue().
        return this.select ? this.select.value : this.get("value", "");
    }

    set value(value) {
        this.setValue(value, false);
    }

    /**
     * Set the value, and say whether that counts as the user choosing it.
     *
     * `setValue(v, true)` fires the action, as ValueChangeEvent + ActionEvent
     * do in Java; assigning to `value` does not.
     */
    setValue(value, fireEvents = false) {
        const next = value ?? "";
        if (this.value === next) return;

        this.set("value", next);
        if (this.select) this.select.value = next;
        if (fireEvents) this.fireAction(next);
    }

    // --- behaviour -----------------------------------------------------------

    /** The user picked an entry: onChange on controlLayer in Java. */
    change() {
        if (!this.enabled) return;
        this.set("value", this.select ? this.select.value : "");
        this.fireAction(this.value);
    }

    /** A disabled combo must not open its list — onPointerDown. */
    pointerDown(event) {
        if (!this.enabled) event.preventDefault?.();
    }

    /**
     * Focus lands on the select, not on the box drawn around it, as
     * ComboBox.setFocus does in Java.
     */
    setFocus(focused) {
        if (!this.select) return;
        if (focused) this.select.focus?.();
        else this.select.blur?.();
    }

    get focused() {
        return (
            !!this.select && this.select === this.select.ownerDocument?.activeElement
        );
    }

    // --- drawing -------------------------------------------------------------

    /** The entries to draw: the children the markup states, or `options`. */
    drawOptions() {
        const children = this.props.children;
        const stated = Array.isArray(children)
            ? children.filter(Boolean)
            : children;
        if (stated && (!Array.isArray(stated) || stated.length > 0)) return stated;

        return this.options.map((option) =>
            typeof option === "string" ? (
                <Option text={option} value={option}/>
            ) : (
                <Option
                    text={option.text}
                    value={option.value}
                    enabled={option.enabled}
                />
            ),
        );
    }

    draw() {
        const props = this.controlProps();

        return (
            <div
                styleName={["v-ComboBox", ...this.controlClasses()]}
                role="listbox"
                aria-disabled={props["aria-disabled"]}
            >
                <select
                    {...props}
                    ref={(el) => (this.select = el)}
                    value={this.get("value", null)}
                    disabled={this.enabled ? null : "true"}
                    autocomplete="off"
                >
                    {this.drawOptions()}
                </select>

                <div styleName="chevron">
                    <ChevronDown aria-hidden="true"/>
                </div>
            </div>
        );
    }
}
