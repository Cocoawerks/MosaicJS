// ToggleControl, ported from GWT Mosaic (client/components/ToggleControl.java).
// The base of the controls that carry a label beside an indicator the user
// flips: CheckBox here, Switch when it is ported.
//
// Java holds `labelLayer` and `indicatorLayer` as UiFields and wires
// aria-labelledby to the label's generated id in `initToggle()`. Here the
// markup is stated in each subclass's `draw()`, and what is shared is the
// label's text and the id the root points at.
import Control from "./Control.js";

/**
 * Ids for the label elements, unique per document — what
 * `HTMLPanel.createUniqueId()` provides in the Java version. A control is
 * labelled by its own label, so aria-labelledby needs an id to name.
 */
let nextId = 0;

export default class ToggleControl extends Control {
  static props = {
    /** The label beside the indicator. */
    text: { type: String, default: "" },
  };

  constructor() {
    super();
    this.labelId = `mosaic-toggle-${++nextId}`;
  }
}
