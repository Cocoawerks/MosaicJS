// MenuItem: one line of a menu.
// An item does not own whether it is the active one — a pointer entering an
// item asks the menu to make it active rather than deciding for itself.
import Control from "../controls/Control.js";
import "./menu.css";

// The chevron shown on an item that opens a menu of its own — what
// SvgIconLibrary.getIcon("svg:chevron-right") hands the Java version.
import ChevronRight from "svg:chevron-right";

export default class MenuItem extends Control {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `MenuItem`. See Component.primaryStyleName.
   */
  static primaryStyleName = "v-MenuItem";

  static properties = {
    /** What the line reads. */
    text: { type: String, default: "" },
    /** What the menu reports when this line is chosen. */
    value: { type: String, default: "" },
    /** A font-icon class name, or an icon component, drawn before it. */
    icon: { type: String },
    /**
     * An image URL or data: URI, drawn in the icon slot instead — the same
     * third form a Button takes.
     *
     * A menu built from things that are buttons elsewhere has to accept every
     * icon they wear, or a line loses its picture on the way in. The overflow
     * menu of a ToolBar is the case that matters: its items are Buttons, and a
     * bar whose icons are images had lines that read as text alone.
     */
    iconImage: { type: String },
    /** Whether it is a rule between items rather than an item. */
    separator: { type: Boolean, default: false },

    // --- what the menu says --------------------------------------------

    /** Whether the pointer or the keyboard is on this line. */
    active: { type: Boolean, default: false },
    /**
     * Whether it opens a menu of its own, which draws the chevron the Java
     * version draws. A menu *of* a menu is not ported: what an item with
     * one does is its own to arrange.
     */
    expandable: { type: Boolean, default: false },
  };

  /** The menu this item belongs to, handed down as it is drawn. */
  get menu() {
    return this.get("menu", null);
  }

  /** A rule is not a line anything can be done with. */
  get canBeActive() {
    return !this.separator && this.enabled;
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * The pointer arrived: the menu is what decides what that means.
   *
   * The keyboard follows it. A menu opened beside an item does not take the
   * keys — that waits on ArrowRight — so pointing into one has to, or the
   * next key pressed would work the menu above the one being pointed at.
   */
  pointerEnter() {
    if (!this.canBeActive) return;
    this.menu?.focusPanel?.();
    this.menu?.activate(this.value);
  }

  /**
   * And left. An item holding a menu of its own keeps it while the pointer is
   * over that menu — the Java version tests the submenu's box for the same
   * reason — so only an item without one goes quiet here.
   */
  pointerLeave(event) {
    if (this.expandable && this.menu?.pointerIsInSubmenu?.(this.value, event))
      return;
    this.menu?.activate(null);
  }

  click(event) {
    event.stopPropagation?.();
    if (!this.canBeActive) return;
    this.menu?.choose(this.value);
  }

  // --- drawing -------------------------------------------------------------

  /**
   * An icon may be a class name or a component, as a Button's may.
   *
   * An item with none draws none: the slot is 19px wide with 12px beside it,
   * and an empty one is that much of a gap before the words for nothing. A
   * menu of plain lines reads as a list rather than as a column of icons that
   * are all missing.
   */
  /** Whether anything is drawn in the icon slot, as Button says it. */
  get hasIcon() {
    return !!(this.icon || this.iconImage);
  }

  drawIcon() {
    // A picture, painted as the slot's background — Button's `iconImage`,
    // drawn the same way here. Only the picture is named; the size of the slot
    // and how the image is fitted into it are the stylesheet's.
    if (this.iconImage) {
      return (
        <i
          styleName={["icon", "iconImage"]}
          style={{ backgroundImage: `url(${this.iconImage})` }}
          aria-hidden="true"
        />
      );
    }

    const icon = this.icon;
    if (!icon) return null;

    if (typeof icon === "function") {
      const Icon = icon;
      return (
        <i styleName="icon">
          <Icon aria-hidden="true" />
        </i>
      );
    }
    return <i styleName={["icon", icon]} aria-hidden="true" />;
  }

  draw() {
    if (this.separator) {
      return (
        <li
          styleName={["v-MenuItem", "v-MenuItem-Separator"]}
          role="separator"
        />
      );
    }

    // An item with an icon says so, and one without says nothing — it has no
    // icon slot at all, so there is nothing for a class to describe.
    return (
      <li
        styleName={[
          "v-MenuItem",
          this.hasIcon ? "hasIcon" : null,
          this.active ? "active" : null,
          ...this.controlClasses(),
        ]}
        role="menuitem"
        data-item={this.value}
        tabindex={null}
        aria-disabled={this.enabled ? null : "true"}
        aria-haspopup={this.expandable ? "menu" : null}
      >
        {this.drawIcon()}
        <span>{this.text}</span>
        <i
          styleName={["icon", "submenu-indicator"]}
          style={{ display: this.expandable ? "block" : "none" }}
          aria-hidden="true"
        >
          <ChevronRight />
        </i>
      </li>
    );
  }
}
