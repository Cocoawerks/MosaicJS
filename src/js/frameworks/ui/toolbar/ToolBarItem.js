// ToolBarItem, ported from GWT Mosaic (client/components/ToolBarItem.java): a
// toolbar button that stacks its icon above a small label. It highlights on
// hover, darkens on press, and fires its action the way any other Button does.
//
//   <ToolBar>
//       <ToolBarItem text="New" icon="fa-file" action="newDocument"/>
//       <ToolBarItem text="Grid" toggle="true" action="toggleGrid"/>
//   </ToolBar>
//
// What it adds to a Button is the face — that is the stylesheet's — and two
// ways of being absent: `hidden`, which the application sets and which takes
// the item out of the bar entirely, and `overflowed`, which the ToolBar sets
// while reflowing and which moves the item into the overflow menu instead.
//
// The Java version also defers a toggle's action to the click rather than the
// press. Here that is Button's business and Button fires on the press, as every
// other toggle in this framework does; an item is no exception to it.
import Button from "../controls/button/Button.js";

import "./toolbar-item.css";

export default class ToolBarItem extends Button {
  static props = {
    /**
     * Whether the application has taken the item out of the bar. A hidden
     * item takes no room and never reaches the overflow menu — it is not
     * there at all, which is what distinguishes it from an overflowed one.
     */
    hidden: { type: Boolean, default: false },
    /**
     * Whether the bar has moved this item into its overflow menu. Set by
     * the ToolBar as it reflows, and not something to write by hand.
     */
    overflowed: { type: Boolean, default: false },
  };

  /** Neither kind of absence is drawn. */
  get isShowing() {
    return !this.hidden && !this.overflowed;
  }

  // --- drawing -------------------------------------------------------------

  buttonClasses() {
    return ["v-ToolBarItem", ...super.buttonClasses()];
  }

  /**
   * An absent item is left in the DOM and taken out of the layout, rather
   * than dropped: the bar measures what it has, and an item that comes back
   * from the overflow menu keeps whatever state it was holding.
   */
  draw() {
    const drawn = super.draw();
    return {
      ...drawn,
      props: {
        ...drawn.props,
        style: { ...drawn.props.style, display: this.isShowing ? "" : "none" },
      },
    };
  }
}
