// Menu, ported from GWT Mosaic (client/components/Menu.java): a popover holding
// a list of items, one of which is active at a time.
//
// The Java version holds a PopOver and passes everything through to it; this one
// is a PopOver, since that is what it draws. What it adds is the list, the
// active item, and the keys that move between them.
//
// In markup the items are the nesting:
//
//   <Menu outlet="menu" action="chosen">
//       <MenuItem text="Cut" value="cut"/>
//       <MenuItemSeparator/>
//       <MenuItem text="Paste" value="paste" enabled="false"/>
//   </Menu>
import { coerceProps, mount, settingValue } from "mosaic";

import PopOver, { PopOverOrientation } from "../popover/PopOver.js";
import MenuItem from "./MenuItem.js";
import "./menu.css";

/**
 * Whether a vnode's type is a menu item — MenuItem itself, or a kind of one.
 * Asked rather than compared, so a subclass an application wrote is a line of
 * the menu like any other; MenuItemSeparator is the framework's own.
 */
function isMenuItem(type) {
  return type === MenuItem || type?.prototype instanceof MenuItem;
}

export default class Menu extends PopOver {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Menu`. See Component.styleName.
   */
  static styleName = "v-Menu";

  static props = {
    /**
     * Whether the menu's left edge lines up with the anchor's rather than
     * being centred on it — what a menu dropped from a bar wants.
     */
    alignLeft: { type: Boolean, default: false },
    /** A menu points at nothing; it drops from something. */
    callout: { type: Boolean, default: false },
    /**
     * Whether this is a menu of a menu, which the sheet draws without a
     * callout of its own. Drawn rather than written onto the element: what
     * a panel wears is `draw`'s to say, and a redraw would rub out anything
     * put there by hand.
     */
    submenu: { type: Boolean, default: false },
    /**
     * One more class for the panel, for a menu another component drops and
     * has something to say about — a menu bar item squares the corners its
     * menu shares with the item it hangs from. Stated here rather than
     * written onto the element for the reason `submenu` is: a redraw would
     * rub out anything put there by hand.
     */
    panelClass: { type: String },
  };

  constructor() {
    super();

    /** The item the pointer or the keyboard is on, or null. */
    this.activeValue = null;

    /** The menus of items that hold one, once they have been wanted. */
    this.openSubmenus = new Map();
    this.submenuHosts = new Map();
  }

  // --- the items -----------------------------------------------------------

  /**
   * The items, as the markup stated them: read from the vnodes, so this is
   * where `enabled="false"` becomes false.
   */
  get items() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];

    return list
      .filter((child) => child && isMenuItem(child.type))
      .map((child, index) => {
        const props = coerceProps(child.props);
        // A menu of its own is what an item holds, if it holds
        // anything: `<MenuItem text="More"><Menu>…</Menu></MenuItem>`.
        const submenu = (child.children ?? []).find(
          (grandchild) => grandchild?.type === Menu,
        );
        // Whether it is a rule is the item's own to say: `separator="true"`
        // on a MenuItem, or being a MenuItemSeparator, whose declaration
        // defaults it true. Asked of the class rather than of what the markup
        // passed, so both arrive here as the same answer.
        const separator =
          settingValue(child.type, "separator", props.separator) === true;

        return {
          // An item is known by its value; failing that by what it
          // reads, and failing that by where it sits.
          value: String(props.value ?? props.text ?? index),
          props,
          vnode: child,
          submenu,
          separator,
          enabled: props.enabled !== false,
        };
      });
  }

  /** The items a pointer or a key can land on: not the rules, not the dead. */
  get liveItems() {
    return this.items.filter((item) => !item.separator && item.enabled);
  }

  // --- what is active ------------------------------------------------------

  /**
   * Make the item carrying `value` the active one, or none of them. An item
   * that holds a menu of its own opens it, and whatever was open closes —
   * `setActive` does both in the Java version.
   */
  activate(value) {
    if (this.activeValue === value) return;
    this.activeValue = value;
    this.needsDisplay();
    this.showSubmenuOf(value);
  }

  /**
   * Open the active item's own menu beside it, and shut any other. It is put
   * at the item's right edge, or at its left when there is no room — the same
   * two placements `MenuItem.showSubMenu` makes.
   *
   * Opened, and no more than that: the keyboard stays in this menu. Stepping
   * onto an item shows what its menu holds, but the keys go on working the
   * menu the stepping is happening in, so ArrowDown past an expandable item
   * reaches the item below it rather than landing in a menu that was never
   * asked for. `enterSubmenu` is what asks.
   */
  showSubmenuOf(value) {
    for (const [open, submenu] of this.openSubmenus) {
      if (open !== value) submenu.hide();
    }

    const item = this.items.find((entry) => entry.value === value);
    if (!item?.submenu) return;

    // Found by walking rather than by selector: a value is whatever the
    // markup said, and quoting it into one is a trap for no gain.
    const line = [...(this.node?.querySelectorAll("li") ?? [])].find(
      (element) => element.getAttribute("data-item") === value,
    );
    if (!line) return;

    const submenu = this.submenuFor(item);
    const box = line.getBoundingClientRect();
    const width = submenu.node?.offsetWidth ?? 0;
    let left = box.right - 4;
    if (left + width > window.innerWidth) left = box.left - width - 14;
    submenu.showAt(left, box.top - 11, false);
  }

  /**
   * Go into the active item's own menu: it opens if it was closed, takes the
   * keyboard, and starts on its first line.
   *
   * The first line every time, whatever the pointer may have left active in
   * there — going in is going in at the top.
   */
  enterSubmenu(value) {
    this.showSubmenuOf(value);

    const submenu = this.openSubmenus.get(value);
    if (!submenu) return;

    submenu.focusPanel();
    const first = submenu.liveItems[0];
    if (first) submenu.activate(first.value);
  }

  /**
   * The mounted menu for an item, built the first time it is wanted. It goes
   * beside the application rather than inside this menu, as this menu does:
   * a panel that floats cannot be nested in one.
   */
  submenuFor(item) {
    const open = this.openSubmenus.get(item.value);
    if (open) return open;

    const host = document.createElement("div");
    document.body.appendChild(host);

    const unmount = mount(Menu, host, {
      ...item.submenu.props,
      children: item.submenu.children,
      submenu: true,
      // A submenu is a menu of this one's: choosing in it chooses here,
      // and a press in either is not a press outside the other.
      action: (submenu, chosen) => this.chosenBelow(chosen),
    });
    const view = unmount.view;
    view.superMenu = this.self;

    view.addCloseException(this.node);
    this.addCloseException(view.node);

    this.openSubmenus.set(item.value, view);
    this.submenuHosts.set(item.value, { host, unmount });
    return view;
  }

  /**
   * Whether a pointer leaving an item went into that item's own menu, give or
   * take a few pixels — the gap between the two is not leaving either.
   */
  pointerIsInSubmenu(value, event) {
    const box = this.openSubmenus.get(value)?.node?.getBoundingClientRect?.();
    if (!box) return false;
    return (
      event.clientX >= box.left - 6 &&
      event.clientX <= box.right + 6 &&
      event.clientY >= box.top - 6 &&
      event.clientY <= box.bottom + 6
    );
  }

  /** An item of a submenu was chosen: this menu goes as well. */
  chosenBelow(value) {
    this.hide();
    this.props.action?.(this.self, value);
  }

  /** Move the active item along the live ones, wrapping at neither end. */
  step(by) {
    const live = this.liveItems;
    if (live.length === 0) return;

    const at = live.findIndex((item) => item.value === this.activeValue);
    // From nothing, a step down starts at the first and a step up at the last.
    const next = at === -1 ? (by > 0 ? 0 : live.length - 1) : at + by;
    if (next < 0 || next >= live.length) return;
    this.activate(live[next].value);
  }

  /**
   * An item was chosen: the menu puts itself away and says which. What a
   * chosen item means is the application's business, so the value goes with
   * it — `ActionEvent(this)` in the Java version, where the item is the event.
   */
  choose(value) {
    const item = this.items.find((entry) => entry.value === value);
    if (!item || item.separator || !item.enabled) return;

    this.hide();
    item.props.action?.(this.self, value);
    this.props.action?.(this.self, value);
  }

  // --- showing -------------------------------------------------------------

  /**
   * Drop the menu from `anchor`: below it when there is room, above it when
   * there is not, and lined up by its left edge when the markup asked for it.
   *
   * The side is settled before it is shown rather than left to the popover's
   * own flip, because a menu is *dropped* from something and its edge, not
   * its middle, is what lines up.
   */
  alignWith(anchor, offsetLeft = 0, offsetTop = 0) {
    const element = anchor?.nodeType === 1 ? anchor : (anchor?.node ?? null);
    if (element) {
      const box = element.getBoundingClientRect();
      const below =
        window.innerHeight - box.bottom >= (this.node?.offsetHeight ?? 0);
      const side = below ? "BOTTOM" : "TOP";
      this.orientation =
        PopOverOrientation[`${side}_${this.alignLeft ? "LEFT" : "CENTER"}`];
    }

    super.alignWith(anchor, offsetLeft, offsetTop);
    this.focusPanel();
  }

  /**
   * Shown at a point rather than under something: a menu of its own place.
   *
   * `focus` is what a submenu opens without. A menu that is dropped is being
   * used, and takes the keyboard; one that is opened beside the item the
   * keyboard is on is only being shown.
   */
  showAt(left, top, focus = true) {
    super.showAt(left, top);
    if (focus) this.focusPanel();
  }

  setOpen(open) {
    super.setOpen(open);
    // Nothing is active in a menu that is not showing, and nothing of its
    // is either.
    if (!open) {
      this.activate(null);
      for (const submenu of this.openSubmenus.values()) submenu.hide();
    }
  }

  /**
   * Put the keyboard on the panel, which is what the keys are read from.
   *
   * Without `preventScroll` the browser brings the focused element into view,
   * and a menu is `position: fixed` — so the page underneath scrolls to chase a
   * panel that was already on screen. Hovering along a title bar's menus made
   * the document jump under the pointer for exactly that reason. Nothing here
   * ever needs scrolling to: the panel was just placed where it is wanted.
   */
  focusPanel() {
    this.node?.focus?.({ preventScroll: true });
  }

  /** The menus this one built go when it does. */
  detached() {
    for (const { host, unmount } of this.submenuHosts.values()) {
      unmount();
      host.remove();
    }
    this.openSubmenus.clear();
    this.submenuHosts.clear();
    super.detached();
  }

  /**
   * A menu's action is the item that was chosen, so opening and closing are
   * reported through `onOpen` and `onClose` alone.
   */
  reportOpen(open) {
    (open ? this.props.onOpen : this.props.onClose)?.(this.self);
  }

  // --- the keyboard --------------------------------------------------------

  keyDown(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault?.();
        this.step(1);
        break;
      case "ArrowUp":
        event.preventDefault?.();
        this.step(-1);
        break;
      case "ArrowRight": {
        // Into the active item's own menu, at its first line. Until this is
        // pressed the menu is only open beside the item — the keyboard is
        // still here.
        const item = this.items.find(
          (entry) => entry.value === this.activeValue,
        );
        if (!item?.submenu) return;
        event.preventDefault?.();
        this.enterSubmenu(item.value);
        break;
      }
      case "ArrowLeft":
        // And back out of one, to the menu it belongs to.
        if (!this.superMenu) return;
        event.preventDefault?.();
        this.hide();
        this.superMenu.focusPanel();
        break;
      case "Enter":
      case " ":
        event.preventDefault?.();
        if (this.activeValue !== null) this.choose(this.activeValue);
        break;
      default:
      // Escape is the popover's, which owns it while it is open.
    }
  }

  // --- drawing -------------------------------------------------------------

  panelClasses() {
    return ["v-Menu", this.submenu ? "submenu" : null, this.panelClass];
  }

  /** The panel is the menu, as it is in Java: the list inside it is plumbing. */
  panelRole() {
    return "menu";
  }

  /**
   * The items, each told whether it is the active one and how to report back.
   * What the markup said about an item is kept — that is the item's business.
   */
  drawItems() {
    return this.items.map((item) => ({
      ...item.vnode,
      props: {
        ...item.props,
        key: item.value,
        value: item.value,
        menu: this.self,
        active: item.value === this.activeValue,
        expandable: !!item.submenu,
      },
    }));
  }

  drawContent() {
    return <ul styleName="content">{this.drawItems()}</ul>;
  }
}
