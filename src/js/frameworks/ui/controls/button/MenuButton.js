// MenuButton, ported from GWT Mosaic (client/components/MenuButton.java): a
// button that latches while a menu of its own is showing.
//
// The menu is mounted beside the application rather than drawn inside the
// button, for the reason a colour well's chooser is: a button may not hold a
// list of things that can be clicked. That is what `RootPanel.get().add(...)`
// does for the Java version, whose Menu adds itself when it is built.
//
// In markup the items are the button's children:
//
//   <MenuButton text="Edit" action="edited">
//       <MenuItem text="Cut" value="cut"/>
//       <MenuItemSeparator/>
//       <MenuItem text="Paste" value="paste"/>
//   </MenuButton>
import { mount } from "mosaic";

import Button, { ButtonState } from "./Button.js";
import Menu from "../../menu/Menu.js";

/** What counts as pressing a button from the keyboard, as Button has it. */
const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

export default class MenuButton extends Button {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `MenuButton`. See Component.styleName.
   */
  static styleName = "v-MenuButton";

  static props = {
    /** A menu button latches while its menu is up. */
    toggle: { type: Boolean, default: true },
  };

  /** The menu, built the first time the button is pressed. */
  buildMenu() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    this.menuHost = host;

    const unmount = mount(Menu, host, {
      // Centred under the button and pointing at it, as
      // `menu.setHasCallout(true)` and the untouched alignment arrange for
      // the Java version. A menu dropped from a *bar* is the one that
      // lines up by its left edge.
      callout: true,
      children: this.props.children,
      action: (menu, value) => this.chose(menu, value),
      onClose: () => this.menuClosed(),
    });
    this.unmountMenu = unmount;
    this.menu = unmount.view;

    // A press on the button is not a press outside the menu: without this
    // the press would put it away and the click would open it again.
    this.menu.addCloseException(this.node);
  }

  /** The menu goes when the button does. */
  detached() {
    this.unmountMenu?.();
    this.menuHost?.remove();
    this.menu = null;
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * Pressing it shows the menu, and pressing it again puts it away — which is
   * what latching means here. The button's action is what the *menu* chose,
   * so the press itself says nothing to the application.
   */
  setButtonState(state) {
    const was = this.buttonState;
    super.setButtonState(state);
    if (this.buttonState === was) return;

    if (this.buttonState === ButtonState.ON) this.showMenu();
    else this.menu?.hide();
  }

  /**
   * A press flips the latch and nothing else. A Button fires its action when
   * it is pressed; this one's action is the item its menu chose, so the press
   * itself says nothing to the application.
   */
  pointerDown(event) {
    if (!this.enabled) {
      event.preventDefault?.();
      return;
    }
    // Primary button only; `button` is 0 for the primary pointer.
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    this.setButtonState(this.on ? ButtonState.OFF : ButtonState.ON);
  }

  /** And from the keyboard, on the keys that press a button. */
  keyDown(event) {
    if (!this.enabled) return;
    if (!ACTIVATION_KEYS.has(event.key)) return;
    event.preventDefault?.();
    this.setButtonState(this.on ? ButtonState.OFF : ButtonState.ON);
  }

  /** The click that follows a press has already been dealt with. */
  click(event) {
    event.preventDefault?.();
  }

  showMenu() {
    if (!this.menu) this.buildMenu();
    else this.menu.props.children = this.props.children;

    // Where the keyboard was, so it can be given back when the menu goes.
    this.focusWas = this.node?.ownerDocument?.activeElement ?? null;
    this.menu.alignWith(this.node);
  }

  /** However the menu was dismissed, the button comes back up. */
  menuClosed() {
    this.setButtonState(ButtonState.OFF);
    this.focusWas?.focus?.({ preventScroll: true });
    this.focusWas = null;
  }

  /** An item was chosen: that is what a menu button has to report. */
  chose(menu, value) {
    this.fireAction(value);
  }

  // --- drawing -------------------------------------------------------------

  buttonClasses() {
    return ["v-MenuButton", ...super.buttonClasses()];
  }

  controlProps() {
    return {
      ...super.controlProps(),
      "aria-haspopup": "menu",
      "aria-expanded": String(this.on),
    };
  }

  /** A button's children are its menu's items, not something it draws. */
  draw() {
    const { children, ...rest } = this.props;
    this.props = rest;
    try {
      return super.draw();
    } finally {
      this.props = { ...rest, children };
    }
  }
}
