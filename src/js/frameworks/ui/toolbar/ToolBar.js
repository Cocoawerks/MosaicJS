// ToolBar: a horizontal bar of ToolBarItems with a rule along its bottom edge.
// In markup the items are the nesting, and anything else the bar should carry
// goes in beside them:
//   <ToolBar>
//       <ToolBarItem text="New" icon="fa-file" action="newDocument"/>
//       <ToolBarItem text="Open" icon="fa-folder" action="open"/>
//       <ToolBarFlex/>
//       <ToolBarItem text="Share" icon="fa-share" action="share"/>
//   </ToolBar>
// When the bar is too narrow to show every item it behaves like a macOS
// NSToolbar: the items that no longer fit are pulled off the trailing edge into
// an overflow ("»") button, whose menu lists them. The bar reflows itself
// whenever its width changes.
import { Component, h, mount } from "mosaic";

import { ButtonState } from "../controls/button/Button.js";
import Menu from "../menu/Menu.js";
import MenuItem from "../menu/MenuItem.js";
import ToolBarItem from "./ToolBarItem.js";

import "./toolbar.css";

// The double chevron the overflow button wears — what
// SvgIconLibrary.getIcon("svg:chevrons-right") hands the Java version, which
// writes the same path into the button by hand.
import ChevronsRight from "svg:chevrons-right";

/**
 * The bar itself fires nothing; each ToolBarItem fires its own `click` (bound
 * bare on the item: `action="method"`, `onClick` in JS), given the item.
 */
export default class ToolBar extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `ToolBar`. See Component.primaryStyleName.
   */
  static primaryStyleName = "v-ToolBar";

  constructor(props) {
    super(props);

    /**
     * How many items, counting from the trailing edge, are in the overflow
     * menu rather than in the bar. Settled by `reflow()`, which measures.
     */
    this.overflowCount = 0;

    /** Whether a measurement is in progress, so it cannot start another. */
    this.measuring = false;
  }

  // --- the items -----------------------------------------------------------

  /** Everything the markup put in the bar, as a flat list of vnodes. */
  get children() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter((child) => child !== null && child !== undefined);
  }

  /**
   * The items overflow may move, in the order they sit in: the ToolBarItems,
   * less any the application has hidden. A hidden item is not in the bar at
   * all, so it is not in the menu either.
   */
  get overflowableItems() {
    return this.children.filter(
      (child) =>
        child.type === ToolBarItem &&
        child.props.hidden !== true &&
        child.props.hidden !== "true",
    );
  }

  /** The components those vnodes drew, found through the nodes they left. */
  itemViews() {
    return this.itemElements().map((element) => element.__ibView);
  }

  /**
   * Their elements, in the order the bar holds them — the ones an item the
   * application hid included, since a hidden item is not in the bar at all.
   * That keeps this list in step with `overflowableItems`, which is how a
   * line of the menu finds the item it stands for.
   */
  itemElements() {
    const bar = this.node;
    if (!bar) return [];
    // Found by the class an item wears rather than by counting children: a
    // bar holds whatever the markup put in it, and what is drawn between the
    // items — a flexible gap, a field — is none of overflow's business.
    return [...bar.childNodes].filter(
      (node) =>
        node.nodeType === 1 &&
        node !== this.overflowNode &&
        (node.getAttribute("class") ?? "")
          .split(/\s+/)
          .includes("v-ToolBarItem") &&
        node.__ibView?.hidden !== true,
    );
  }

  /**
   * What the overflow button sits in — the last thing the bar draws, and what
   * is taken out of the layout while nothing overflows. The button is wrapped
   * rather than styled directly because its element is Button's drawing, and
   * a class this module states could not reach it.
   */
  get overflowNode() {
    return this.overflowRef ?? null;
  }

  // --- reflowing -----------------------------------------------------------

  attached() {
    // The bar's own box is what decides how much fits, so that is what is
    // watched: an item hiding does not change it, and a window or a panel
    // beside the bar changing size does.
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(() => this.reflow());
      this.observer.observe(this.node);
    } else if (typeof window !== "undefined") {
      this.onWindowResize = () => this.reflow();
      window.addEventListener("resize", this.onWindowResize);
    }
    this.reflow();
  }

  detached() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.onWindowResize) {
      window.removeEventListener("resize", this.onWindowResize);
      this.onWindowResize = null;
    }
    this.unmountMenu?.();
    this.menuHost?.remove();
    this.menu = null;
  }

  /** True when the bar's content is wider than the room it has for it. */
  overflows() {
    // The extra pixel absorbs sub-pixel rounding, so a bar that fits exactly
    // does not flicker an empty menu.
    return this.node.scrollWidth > this.node.clientWidth + 1;
  }

  /**
   * Work out how many items no longer fit, and put those in the menu.
   *
   * The measurement is made with everything showing and the overflow button
   * away, then items are taken off the trailing edge — as macOS does, so the
   * leading ones survive longest — until the bar fits again. The display it
   * writes while measuring is what the next drawing states from
   * `overflowCount`, so the two never disagree; nothing is left behind.
   */
  reflow() {
    const bar = this.node;
    if (!bar || this.measuring) return;
    this.measuring = true;
    try {
      const elements = this.itemElements();
      for (const element of elements) element.style.display = "";
      if (this.overflowNode) this.overflowNode.style.display = "none";

      let hidden = 0;
      if (this.overflows()) {
        // Something spills, so the overflow button is there — and it takes
        // room of its own, which is why it is revealed before measuring on.
        if (this.overflowNode) this.overflowNode.style.display = "";
        for (let i = elements.length - 1; i >= 0 && this.overflows(); i--) {
          elements[i].style.display = "none";
          hidden++;
        }
        // Nothing could be moved — a single item wider than the bar — so
        // there is no menu to strand a button in front of.
        if (hidden === 0 && this.overflowNode) {
          this.overflowNode.style.display = "none";
        }
      }

      if (hidden !== this.overflowCount) {
        this.overflowCount = hidden;
        this.needsDisplay();
      }
      this.updateMenu();
    } finally {
      this.measuring = false;
    }
  }

  /** The items now in the menu, leading-first, as vnodes. */
  get overflowedItems() {
    const items = this.overflowableItems;
    return this.overflowCount === 0
      ? []
      : items.slice(items.length - this.overflowCount);
  }

  // --- the overflow menu ---------------------------------------------------

  /** Whether the overflow button is in the bar at all. */
  get hasOverflow() {
    return this.overflowCount > 0;
  }

  /**
   * The menu, built the first time it is wanted. It is mounted beside the
   * application rather than drawn inside the bar, as every floating panel in
   * this framework is: a bar may not hold something that hangs over the page.
   */
  buildMenu() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    this.menuHost = host;

    const unmount = mount(Menu, host, {
      // A menu dropped from a bar points at nothing; it drops.
      callout: false,
      children: [],
      onClose: () => this.menuClosed(),
    });
    this.unmountMenu = unmount;
    this.menu = unmount.view;

    // A press on the button that opens it is not a press outside, or the
    // press would put the menu away and the click would open it again.
    if (this.overflowNode) this.menu.addCloseException(this.overflowNode);
    return this.menu;
  }

  /**
   * Restate the menu from whatever is overflowing. Each line carries what its
   * item reads and wears, and choosing it works the item itself — so an item
   * behaves the same whether it was clicked in the bar or chosen from here.
   */
  updateMenu() {
    if (!this.hasOverflow) {
      this.menu?.hide();
      return;
    }
    const menu = this.menu ?? this.buildMenu();
    const views = this.itemViews();
    const count = this.overflowCount;

    menu.props = {
      ...menu.props,
      children: this.overflowedItems.map((item, index) => {
        const view = views[views.length - count + index];
        const props = item.props;
        return h(MenuItem, {
          value: String(index),
          text: props.text ?? "",
          // Both forms an item's icon may take. A ToolBarItem is a Button, so
          // its picture may be a font class, an icon component or an image —
          // and a line that carried only the first two lost the icon of every
          // item drawn from a picture, which is what a ported toolbar's are.
          icon: props.icon ?? null,
          iconImage: props.iconImage ?? null,
          enabled: view ? view.enabled : props.enabled !== false,
          action: () => view?.fireAction(),
        });
      }),
    };
    menu.needsDisplay();
  }

  /** The button was pressed: the menu goes up, or comes down. */
  showOverflowMenu(button) {
    const menu = this.menu ?? this.buildMenu();
    this.updateMenu();
    if (button.buttonState === ButtonState.ON) {
      menu.alignWith(button.node ?? this.overflowNode);
    } else {
      menu.hide();
    }
  }

  /** However the menu was dismissed, the button comes back up with it. */
  menuClosed() {
    if (this.overflowButton) this.overflowButton.buttonState = ButtonState.OFF;
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The items, each told whether the bar has moved it into the menu. What the
   * markup said about an item is otherwise left alone — that is the item's.
   */
  drawChildren() {
    const overflowed = new Set(this.overflowedItems);
    return this.children.map((child, index) => {
      if (child.type !== ToolBarItem) return child;
      return {
        ...child,
        props: {
          ...child.props,
          key: child.props.key ?? index,
          overflowed: overflowed.has(child),
        },
      };
    });
  }

  // The overflow button's click is caught a level out rather than the item
  // taking an `action`: `action` in markup names a method on the controller,
  // and what is wanted here is the bar's own menu. By the time the click
  // arrives the item has already latched, so `on` says whether the menu
  // should be up — and a disabled item stops its click, which is the same
  // thing SpinButton's step buttons rely on.
  draw() {
    return (
      <div styleName="v-ToolBar" role="toolbar">
        {this.drawChildren()}

        <div
          styleName="v-ToolBar-overflow"
          style={{ display: this.hasOverflow ? "" : "none" }}
          ref={(element) => (this.overflowRef = element)}
          onclick={() => this.showOverflowMenu(this.overflowButton)}
        >
          <ToolBarItem
            icon={ChevronsRight}
            iconOnly
            toggle
            tooltip={this.message("More")}
            aria-label={this.message("More")}
            ref={(item) => (this.overflowButton = item)}
          />
        </div>
      </div>
    );
  }
}
