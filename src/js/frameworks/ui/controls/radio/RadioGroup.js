// RadioGroup, ported from GWT Mosaic (client/components/RadioGroup.java): the
// list that owns which of its Radios is chosen.
//
// The group holds the value and hands each option its `selected`, so exactly
// one can be chosen and a Radio never has to know about its siblings. In
// markup that reads as the nesting itself:
//
//   <RadioGroup outlet="size" action="sizeChanged" value="medium">
//       <Radio text="Small" value="small"/>
//       <Radio text="Medium" value="medium"/>
//   </RadioGroup>
import { coerceProps } from "mosaic";

import Control from "../Control.js";
import Radio from "./Radio.js";
import "./radio.css";

/** Which way each arrow key moves through the options. */
const STEPS = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1,
  Up: -1,
  Left: -1,
  Down: 1,
  Right: 1,
};

export default class RadioGroup extends Control {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `RadioGroup`. See Component.styleName.
   */
  static styleName = "v-RadioGroup";

  // --- value ---------------------------------------------------------------

  /** The value of the chosen option, or "" while nothing is chosen. */
  get value() {
    return this.get("value", "");
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Choose the option carrying `value`, and say whether that counts as the
   * user choosing it. `setValue(v, true)` fires the action.
   */
  setValue(value, fireEvents = false) {
    const next = value ?? "";
    if (this.value === next) return;

    this.set("value", next);
    this.needsDisplay();
    if (fireEvents) this.fireAction(next);
  }

  /**
   * The options, as the markup stated them.
   *
   * These are vnodes the group reads before any of them is drawn, so their
   * props have not been through a component yet: this is where they are
   * read, and so this is where `enabled="false"` becomes false.
   */
  get options() {
    const children = this.props.children;
    return (Array.isArray(children) ? children.flat(Infinity) : [children])
      .filter((child) => child && child.type === Radio)
      .map((option) => ({ ...option, props: coerceProps(option.props) }));
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * The arrow keys move the choice to the nearest enabled option, skipping
   * disabled ones so the keyboard never lands on one, and stopping at the
   * ends rather than wrapping — as the Java version does.
   */
  keyDown(event) {
    if (!this.enabled) return;

    const step = STEPS[event.key];
    if (!step) return;
    event.preventDefault?.();

    const options = this.options;
    const from = options.findIndex(
      (option) => (option.props.value ?? "") === this.value,
    );

    for (let i = from + step; i >= 0 && i < options.length; i += step) {
      if (options[i].props.enabled !== false) {
        this.setValue(options[i].props.value ?? "", true);
        this.focusChosen();
        return;
      }
    }
  }

  /** Move focus to the chosen option, which is the group's one tab stop. */
  focusChosen() {
    for (const item of this.node?.childNodes ?? []) {
      if (item.getAttribute?.("tabindex") === "0") {
        item.focus?.();
        return;
      }
    }
  }

  /** An option was clicked: it says which, and the group decides. */
  choose(radio, value) {
    this.setValue(value, true);
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The options, each told whether it is the chosen one and how to say it was
   * clicked. Their own props are kept — what the markup said about an option
   * is the option's business.
   */
  drawOptions() {
    return this.options.map((option) => ({
      ...option,
      props: {
        ...option.props,
        selected: (option.props.value ?? "") === this.value,
        enabled: option.props.enabled !== false && this.enabled,
        action: (radio, value) => this.choose(radio, value),
      },
    }));
  }

  draw() {
    return (
      <ul
        {...this.controlProps()}
        styleName={["v-RadioGroup", ...this.controlClasses()]}
        role="radiogroup"
        tabindex={null}
      >
        {this.drawOptions()}
      </ul>
    );
  }
}
