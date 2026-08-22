// SearchField, ported from GWT Mosaic (client/components/SearchField.java +
// its SearchField.ui.xml template): a text field with a magnifier before the
// text and a clear button after it, shown only while there is something to
// clear.
import TextBase from "./TextBase.js";

import Magnifier from "svg:search";
import CloseCircle from "svg:close-circle";

import "./search.css";

export default class SearchField extends TextBase {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `SearchField`. See Component.styleName.
   */
  static styleName = "v-Search";

  /** "Search", unless the application words it differently. */
  get placeholder() {
    return this.get("placeholder", "Search");
  }

  set placeholder(value) {
    this.set("placeholder", value);
  }

  /** What the clear button reports to `action="cancel:method"`. */
  fireCancel() {
    const control = this.self;
    control.props.cancelAction?.(control);
  }

  /**
   * Empty the field, put the cursor back in it and say so. The value change
   * is reported as the user's, because clearing is something they did.
   */
  clear() {
    this.setValue("", true);
    this.setFocus(true);
    this.fireCancel();
  }

  // --- drawing -------------------------------------------------------------
  //
  // The box and the input are TextBase's; what a search field adds is the
  // magnifier before the text and the button that empties it after.

  get role() {
    return "searchbox";
  }

  boxClasses() {
    return ["v-Search", ...super.boxClasses()];
  }

  drawPrefix() {
    return (
      <i styleName="search">
        <Magnifier aria-hidden="true" />
      </i>
    );
  }

  drawSuffix() {
    // Nothing to clear while the field is empty, so the button is not there
    // to be reached — by a pointer or by a screen reader.
    const empty = this.value === "";

    return (
      <button
        styleName="Search-reset"
        type="button"
        aria-label="Clear search"
        aria-hidden={empty ? "true" : "false"}
        style={{ display: empty ? "none" : "block" }}
        tabindex={empty ? "-1" : "0"}
        onclick={() => this.clear()}
        onmousedown={(event) => event.preventDefault?.()}
      >
        <i>
          <CloseCircle aria-hidden="true" />
        </i>
      </button>
    );
  }

  inputExtras() {
    return { "aria-label": "Search" };
  }
}
