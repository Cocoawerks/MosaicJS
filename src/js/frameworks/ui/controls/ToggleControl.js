// ToggleControl: the base of the controls that carry a label beside an
// indicator the user flips — CheckBox and Switch.
// The markup is stated in each subclass's `draw()`; what is shared is the
// label's text and the id the root points at for `aria-labelledby`.
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

  constructor(props) {
    super(props);
    this.labelId = `mosaic-toggle-${++nextId}`;
  }
}
