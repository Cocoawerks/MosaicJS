// Radio, ported from GWT Mosaic (client/components/Radio.java + its
// Radio.ui.xml template): one option in a RadioGroup.
//
// A radio does not own whether it is selected — one of a group is, and the
// group says which. So `selected` arrives as a prop, and a click asks the
// group to choose this one rather than deciding for itself. That is the same
// arrangement as the Java version, where Radio.setSelected() goes through
// `radioGroup`.
import ToggleControl from "../ToggleControl.js";
import "./radio.css";

export default class Radio extends ToggleControl {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Radio`. See Component.styleName.
   */
  static styleName = "v-Radio";

  static props = {
    /** Whether this is the group's chosen option. */
    selected: { type: Boolean, default: false },
  };

  /** What the group reports when this option is the chosen one. */
  get value() {
    return this.get("value", "");
  }

  set value(value) {
    this.set("value", value ?? "");
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * Only the chosen option is in the tab order, and only while enabled: a
   * group is one stop, and the arrow keys move within it.
   */
  get tabIndex() {
    return this.get("tabIndex", this.enabled && this.selected ? 0 : -1);
  }

  set tabIndex(value) {
    this.set("tabIndex", value);
  }

  click(event) {
    if (!this.enabled) return;
    event.preventDefault?.();

    // Choosing an option that is already chosen is not a change, and the
    // group is what decides either way.
    this.fireAction(this.value);
  }

  // --- drawing -------------------------------------------------------------

  draw() {
    const selected = this.selected;

    return (
      <li
        {...this.controlProps()}
        styleName={["v-Radio", ...this.controlClasses()]}
        role="radio"
        aria-checked={String(selected)}
        aria-labelledby={this.labelId}
      >
        <div styleName={["indicator", selected ? "checked" : null]} />
        <span id={this.labelId}>{this.text}</span>
      </li>
    );
  }
}
