// MenuBarItem, ported from GWT Mosaic (client/components/MenuBarItem.java): a
// TitleBarButton that drops a Menu. It latches while the menu is up and comes
// back off however the menu closed — by a choice, a press outside or Escape.
//
// In markup the items are the nesting, as a MenuButton's are:
//
//   <TitleBar>
//       <MenuBarItem slot="actions" text="File" action="chose">
//           <MenuItem text="New" value="new"/>
//           <MenuItem separator="true"/>
//           <MenuItem text="Close" value="close"/>
//       </MenuBarItem>
//   </TitleBar>
//
// A bar of them behaves as one control: with a menu already up, moving the
// pointer onto a sibling switches to that item's menu without a press — which
// is what `openItem` below is for, and why it is the class's and not an
// instance's.
//
// Much of this is MenuButton said again. The two cannot share it: a MenuButton
// is a Button and this is a TitleBarButton, and what a menu bar item looks like
// is the half that matters — the Java version makes the same choice.
import {mount} from "mosaic";

import {ButtonState} from "../controls/button/Button.js";
import Menu from "../menu/Menu.js";
import TitleBarButton from "./TitleBarButton.js";

import "./menubaritem.css";

// The trailing chevron, off unless asked for — what
// SvgIconLibrary.getIcon("svg:chevron-down") hands the Java version.
import ChevronDown from "svg:chevron-down";

/** What counts as pressing a button from the keyboard, as Button has it. */
const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

/**
 * The gap a popover leaves below what it hangs from, for a callout. Undone
 * here so the menu meets the item's bottom edge: a menu bar's menu hangs off
 * the item rather than floating below it.
 */
const MENU_GAP = 9;

export default class MenuBarItem extends TitleBarButton {
    static props = {
        /** A menu bar item latches while its menu is up. */
        toggle: {type: Boolean, default: true},
        /**
         * Whether the trailing chevron is drawn. Off by default: an item's
         * label usually says enough on its own.
         */
        showChevron: {type: Boolean, default: false},
    };

    /**
     * The item whose menu is up, across the whole page. One at a time is what
     * makes a row of these read as a menu bar rather than as a row of buttons.
     */
    static openItem = null;

    /** The menu, built the first time the item is pressed. */
    buildMenu() {
        const host = document.createElement("div");
        document.body.appendChild(host);
        this.menuHost = host;

        const unmount = mount(Menu, host, {
            // It drops from the item's left edge rather than pointing at its
            // middle: an item in a bar is what a menu hangs off.
            callout: false,
            alignLeft: true,
            // Which lets the sheet square the corners it shares with the item.
            panelClass: "v-MenuBarItem-menu",
            children: this.props.children,
            action: (menu, value) => this.chose(menu, value),
            onClose: () => this.menuClosed(),
        });
        this.unmountMenu = unmount;
        this.menu = unmount.view;

        // A press on the item is not a press outside its menu: without this the
        // press would put the menu away and the click would open it again.
        this.menu.addCloseException(this.node);
    }

    /** The menu goes when the item does, and the bar forgets it was open. */
    detached() {
        if (MenuBarItem.openItem === this.self) MenuBarItem.openItem = null;
        this.unmountMenu?.();
        this.menuHost?.remove();
        this.menu = null;
    }

    // --- behaviour -----------------------------------------------------------

    /**
     * Latching is what shows the menu, whatever did the latching — a press, a
     * key, or a sibling handing over.
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

    /**
     * With a sibling's menu already up, the pointer arriving here takes it
     * over: the bar is one control while it is open, and walking along it
     * should not need a press per item.
     */
    pointerEnter() {
        const open = MenuBarItem.openItem;
        if (!this.enabled || !open || open === this.self) return;
        open.hideMenu();
        this.setButtonState(ButtonState.ON);
    }

    // --- the menu ------------------------------------------------------------

    showMenu() {
        if (!this.menu) this.buildMenu();
        else this.menu.props.children = this.props.children;

        MenuBarItem.openItem = this.self;
        // Where the keyboard was, so it can be given back when the menu goes.
        this.focusWas = this.node?.ownerDocument?.activeElement ?? null;
        // The offset closes the gap a popover leaves for its callout, so the
        // menu meets the item's bottom edge.
        this.menu.alignWith(this.node, 0, -MENU_GAP);
    }

    /** Put the menu away, whatever asked. The latch follows from the close. */
    hideMenu() {
        this.menu?.hide();
    }

    /** However the menu was dismissed, the item comes back up. */
    menuClosed() {
        if (MenuBarItem.openItem === this.self) MenuBarItem.openItem = null;
        this.setButtonState(ButtonState.OFF);
        this.focusWas?.focus?.();
        this.focusWas = null;
    }

    /** An item was chosen: that is what a menu bar item has to report. */
    chose(menu, value) {
        this.fireAction(value);
    }

    // --- drawing -------------------------------------------------------------

    buttonClasses() {
        return ["v-MenuBarItem", ...super.buttonClasses()];
    }

    controlProps() {
        return {
            ...super.controlProps(),
            "aria-haspopup": "menu",
            "aria-expanded": String(this.on),
        };
    }

    /**
     * The chevron, after the label so it sits at the trailing edge. Inside an
     * `<i>` rather than on the SVG itself, as the Java version puts it: what
     * the sheet sizes and dims is the wrapper.
     */
    drawSuffix() {
        if (!this.showChevron) return null;
        return (
            <i styleName="chevron" aria-hidden="true">
                <ChevronDown/>
            </i>
        );
    }

    /** An item's children are its menu's items, not something it draws. */
    draw() {
        const {children, ...rest} = this.props;
        this.props = rest;
        try {
            return super.draw();
        } finally {
            this.props = {...rest, children};
        }
    }
}
