// TitleBarButton: a ToolBarItem-style button sized for
// a TitleBar — the same flat, borderless treatment and the same kinds of icon,
// but laid out in a row, a small icon with its label beside it, and short
// enough to sit inside the bar's height, where the toolbar's icon-over-label
// stack would not fit.
//
//   <TitleBarButton slot="trailing" text="Ada" icon="fa-user" toggle="true"
//                   action="showAccount"/>
//
// Items are momentary unless `toggle` makes them latch, which is what an item
// opening a popover wants: it stays down for as long as the thing it opened is
// up. Latching is Button's, and so is when it fires; what this adds is the face.
import Button from "../controls/button/Button.js";

import "./titlebar-button.css";

export default class TitleBarButton extends Button {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `TitleBarButton`. See Component.styleName.
   */
  static styleName = "v-TitleBarButton";

  buttonClasses() {
    return ["v-TitleBarButton", ...super.buttonClasses()];
  }
}
