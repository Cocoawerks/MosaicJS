// Toast, ported from GWT Mosaic (client/components/Toast.java): a snackbar of
// one line of text and nothing else — no close button, since it goes on its own.
//
//   this.bars.toast("Everything was saved", Intent.SUCCESS);
//
// which is what `SnackBarManager#toast` does, or as markup where a page holds
// one of its own:
//
//   <Toast text="Everything was saved" intent="success"/>
import SnackBar from "./SnackBar.js";
import "./snackbar.css";

export default class Toast extends SnackBar {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Toast`. See Component.styleName.
   */
  static styleName = "v-Toast";

  static props = {
    /** The line it says. */
    text: { type: String, default: "" },
    /** A toast has no close button: it takes itself away. */
    userClosable: { type: Boolean, default: false },
  };

  barClasses() {
    return [...super.barClasses(), "v-Toast"];
  }

  /** The line, and whatever else it was given after it. */
  drawContent() {
    return (
      <>
        <span>{this.text}</span>
        {this.props.children}
      </>
    );
  }
}
