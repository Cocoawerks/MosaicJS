// ComboBox, ported from GWT Mosaic (client/components/ComboBox.java + its
// ComboBox.ui.xml template): a native `<select>` in a framed box, with a
// chevron drawn beside it.
//
// The native control is the point — it brings the platform's own list, its
// keyboard handling and its accessibility with it. What the component adds is
// the frame, the chevron and the theme.
//
// Java takes its entries as child `Option` widgets appended to the select.
// Here they are child components, or an `options` list for code that would
// rather pass data:
//
//   <ComboBox outlet="colour" action="colourChanged">
//       <Option text="Red" value="red"/>
//   </ComboBox>
//
//   <ComboBox options={["Red", "Green"]} value="Red" action="colourChanged"/>
//
// `popup` draws the list as a Mosaic Menu instead of the platform's, the way a
// macOS popup button works — see `showMenu`.
import { coerceProps, mount } from "mosaic";

import Control from "../Control.js";
import Menu from "../../menu/Menu.js";
import MenuItem from "../../menu/MenuItem.js";
import Option from "./Option.js";
import "./combobox.css";

// The chevron a combo box wears, resolved at compile time out of the
// framework's icons — what SvgIconLibrary.getIcon("svg:chevron-down") hands
// the Java version. A native list drops below the control, and this says so.
import ChevronDown from "svg:chevron-down";
// A popup's is the pair: its menu stands *over* the control and may go either
// way, so a single downward chevron would promise something it does not do.
import ChevronUpDown from "svg:chevron-up-down";
// And the tick beside the entry a popup menu is currently on.
import Check from "svg:check";

/** The keys that open a popup's menu, as a macOS popup button opens on. */
const POPUP_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " ", "Spacebar"]);

/** How near the edge of the window a popup's menu may be placed. */
const MARGIN = 8;

export default class ComboBox extends Control {
  static props = {
    /**
     * Draw the entries as a Mosaic Menu rather than as the platform's own
     * list — a macOS popup button rather than a combo box.
     *
     * The native `<select>` is the better thing by default: it brings the
     * platform's list, its keyboard handling and its accessibility with it.
     * What it cannot bring is the framework's own face, or a list that opens
     * over the control with the chosen entry under the pointer. That is what
     * this is for.
     */
    popup: { type: Boolean, default: false },
  };

  // --- entries -------------------------------------------------------------

  /**
   * The entries, when they are given as data rather than as child `Option`s:
   * a list of strings, or of `{text, value, enabled}`. Children win — they
   * are what the markup states.
   */
  get options() {
    return this.get("options", []);
  }

  set options(value) {
    this.set("options", value ?? []);
  }

  /**
   * The entries as data, whichever way they were stated: `{text, value,
   * enabled}` for each. A popup draws a menu rather than `<option>`s, and a
   * menu takes what an entry says rather than the entry itself.
   */
  get entries() {
    const children = this.props.children;
    const stated = (
      Array.isArray(children) ? children.flat(Infinity) : [children]
    )
      .filter((child) => child && child.type === Option)
      .map((child) => coerceProps(child.props));

    const from = stated.length > 0 ? stated : this.options;
    return from.map((option) => {
      if (typeof option === "string") {
        return { text: option, value: option, enabled: true };
      }
      // An Option's text falls back to its value, as a bare `<option>` does.
      const value = String(option.value ?? option.text ?? "");
      return {
        text: String(option.text ?? value),
        value,
        enabled: option.enabled !== false,
      };
    });
  }

  /** What the chosen entry reads, which is what a popup's trigger shows. */
  get text() {
    const chosen = this.entries.find((entry) => entry.value === this.value);
    return chosen?.text ?? "";
  }

  // --- value ---------------------------------------------------------------

  /** The value of the chosen entry. `HasValue<String>` in Java. */
  get value() {
    // Once it is on screen the select is the truth: the user can change it
    // without anything here being told, exactly as in the Java version,
    // which reads controlLayer.getValue(). A popup has no select, and what it
    // was told is all there is.
    if (this.select) return this.select.value;

    const stated = this.get("value", null);
    if (stated !== null && stated !== undefined) return stated;

    // Nothing stated: a native select shows its first entry, so a popup does
    // too rather than opening on an empty trigger.
    return this.entries[0]?.value ?? "";
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Set the value, and say whether that counts as the user choosing it.
   *
   * `setValue(v, true)` fires the action, as ValueChangeEvent + ActionEvent
   * do in Java; assigning to `value` does not.
   */
  setValue(value, fireEvents = false) {
    const next = value ?? "";
    if (this.value === next) return;

    this.set("value", next);
    if (this.select) this.select.value = next;
    // A popup's trigger reads the chosen entry, so it is drawn again.
    if (this.popup) this.needsDisplay();
    if (fireEvents) this.fireAction(next);
  }

  // --- behaviour -----------------------------------------------------------

  /** The user picked an entry: onChange on controlLayer in Java. */
  change() {
    if (!this.enabled) return;
    this.set("value", this.select ? this.select.value : "");
    this.fireAction(this.value);
  }

  /**
   * A disabled combo must not open its list — onPointerDown. A popup has no
   * native list to open, so the press is what opens its menu.
   */
  pointerDown(event) {
    if (!this.enabled) {
      event.preventDefault?.();
      return;
    }
    if (!this.popup) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    if (this.open) this.menu?.hide();
    else this.showMenu();
  }

  /**
   * A popup opens on the keys that open a list: the arrows, Enter and Space,
   * as a macOS popup button does. Everything else is left to the browser.
   */
  keyDown(event) {
    if (!this.popup || !this.enabled || this.open) return;
    if (!POPUP_KEYS.has(event.key)) return;
    event.preventDefault?.();
    this.showMenu();
  }

  // --- the popup menu ------------------------------------------------------

  /** Whether the popup's menu is up. */
  get open() {
    return !!this.menu?.visible;
  }

  /**
   * Show the entries as a menu over the control, the way a macOS popup button
   * does: the menu is as wide as the control, its left edge lined up with it,
   * and it is placed so the chosen entry falls on the control itself rather
   * than below it — the pointer starts on what is already chosen, and a press
   * and release without moving picks it again.
   *
   * Kept on screen: a chosen entry near either end of a long list would put
   * the menu off the top or the bottom, so the placement is clamped and the
   * menu simply opens as near to right as there is room for.
   */
  showMenu() {
    if (!this.menu) this.buildMenu();
    else this.menu.props.children = this.drawMenuItems();

    const box = this.node?.getBoundingClientRect?.();
    if (!box) return;

    // Against the node as it is now, not as it was when the menu was built: a
    // redraw since then left a stale one, and the press that opened the menu
    // is still on its way through the document — reaching the popover as a
    // press outside it, which put the menu away the instant it went up.
    this.menu.addCloseException(this.node);
    this.focusWas = this.node?.ownerDocument?.activeElement ?? null;

    // Shown before it is placed: a menu that has never been laid out has no
    // height to place it by, and no rows to measure the chosen one against.
    this.menu.showAt(box.left, box.top);
    this.menu.node.style.minWidth = `${Math.round(box.width)}px`;

    // Found by walking rather than by selector, as Menu finds its own lines:
    // a value is whatever the markup said, and quoting one into a selector is
    // a trap for no gain.
    const chosen = [...this.menu.node.querySelectorAll("li")].find(
      (line) => line.getAttribute("data-item") === this.value,
    );
    const panel = this.menu.node.getBoundingClientRect();
    const offset = chosen ? chosen.getBoundingClientRect().top - panel.top : 0;

    const room = window.innerHeight - panel.height - MARGIN;
    const top = Math.max(MARGIN, Math.min(box.top - offset, room));
    this.menu.showAt(box.left, top);

    // Opened on what is already chosen, so the arrows step from there.
    if (this.value !== "") this.menu.activate(this.value);
    // Written rather than drawn: a redraw here would replace the node the
    // press is still travelling through, and the popover would lose track of
    // what it is allowed to be pressed on.
    this.node?.setAttribute?.("aria-expanded", "true");
  }

  /**
   * Where the menu is hosted: the body, unless the control is inside a modal
   * `<dialog>`.
   *
   * A dialog shown with showModal() is in the browser's top layer, which
   * nothing in the page can stack above and nothing outside can be pressed
   * through — a menu on the body would be drawn behind the dialog and be inert
   * besides. Hosted inside the dialog it is in the top layer with it.
   */
  menuParent() {
    return this.node?.closest?.("dialog[open]") ?? document.body;
  }

  buildMenu() {
    const host = document.createElement("div");
    this.menuParent().appendChild(host);
    this.menuHost = host;

    const unmount = mount(Menu, host, {
      // Neither dropped from something nor pointing at it: a popup's menu
      // stands over the control, so it wears no callout and lines up by its
      // left edge.
      callout: false,
      alignLeft: true,
      panelClass: "v-ComboBox-menu",
      children: this.drawMenuItems(),
      action: (menu, value) => this.setValue(value, true),
      onClose: () => this.menuClosed(),
    });
    this.unmountMenu = unmount;
    this.menu = unmount.view;

    // A press on the control is not a press outside the menu: without this the
    // press would put it away and the release would open it again.
    this.menu.addCloseException(this.node);
  }

  /** One line per entry, the chosen one ticked. */
  drawMenuItems() {
    const value = this.value;
    return this.entries.map((entry) => (
      <MenuItem
        text={entry.text}
        value={entry.value}
        enabled={entry.enabled}
        icon={entry.value === value ? Check : null}
      />
    ));
  }

  /** However the menu was dismissed, the trigger comes back up. */
  menuClosed() {
    this.focusWas?.focus?.();
    this.focusWas = null;
    this.needsDisplay();
  }

  /** The menu goes when the control does. */
  detached() {
    this.unmountMenu?.();
    this.menuHost?.remove();
    this.menu = null;
    super.detached?.();
  }

  /**
   * Focus lands on the select, not on the box drawn around it, as
   * ComboBox.setFocus does in Java.
   */
  setFocus(focused) {
    if (!this.select) return;
    if (focused) this.select.focus?.();
    else this.select.blur?.();
  }

  get focused() {
    return (
      !!this.select && this.select === this.select.ownerDocument?.activeElement
    );
  }

  // --- drawing -------------------------------------------------------------

  /** The entries to draw: the children the markup states, or `options`. */
  drawOptions() {
    const children = this.props.children;
    const stated = Array.isArray(children)
      ? children.filter(Boolean)
      : children;
    if (stated && (!Array.isArray(stated) || stated.length > 0)) return stated;

    return this.options.map((option) =>
      typeof option === "string" ? (
        <Option text={option} value={option} />
      ) : (
        <Option
          text={option.text}
          value={option.value}
          enabled={option.enabled}
        />
      ),
    );
  }

  draw() {
    const props = this.controlProps();
    if (this.popup) return this.drawPopup(props);

    return (
      <div
        styleName={["v-ComboBox", ...this.controlClasses()]}
        role="listbox"
        aria-disabled={props["aria-disabled"]}
      >
        <select
          {...props}
          ref={(el) => (this.select = el)}
          value={this.get("value", null)}
          disabled={this.enabled ? null : "true"}
          autocomplete="off"
        >
          {this.drawOptions()}
        </select>

        <div styleName="chevron">
          <ChevronDown aria-hidden="true" />
        </div>
      </div>
    );
  }

  /**
   * The popup's trigger: what is chosen, and the mark that says there is a
   * list behind it. No `<select>` — the entries are the menu's, and a native
   * one under this would bring a second list nothing opens.
   */
  /*
   * The sizer below holds every entry, drawn where the label is drawn and
   * hidden there: the box is then as wide as its widest entry rather than as
   * wide as whatever happens to be chosen, so choosing does not resize it. See
   * the sizer's rules in combobox.css.
   *
   * Written here rather than inside the markup: the compiler reads a brace as
   * an expression, so a JSX-style comment in one is a syntax error.
   */
  drawPopup(props) {
    return (
      <div
        {...props}
        styleName={["v-ComboBox", "popup", ...this.controlClasses()]}
        role="button"
        tabindex={this.enabled ? "0" : null}
        aria-haspopup="listbox"
        aria-expanded={String(this.open)}
      >
        <span styleName="label">{this.text}</span>

        <span styleName="sizer" aria-hidden="true">
          {this.entries.map((entry) => (
            <span styleName="ghost">{entry.text}</span>
          ))}
        </span>

        <div styleName="chevron">
          <ChevronUpDown aria-hidden="true" />
        </div>
      </div>
    );
  }
}
