// OutlineItem, ported from GWT Mosaic (client/components/OutlineItem.java +
// its OutlineItem.ui.xml template): one row of an OutlineView.
//
// A row does not own whether it is selected or open — the view does, and says
// so through props — so a click asks the view rather than deciding for itself.
// That is the same arrangement as the Java version, where setSelected() and the
// item's level both go through `outlineView`.
//
// Its own rows are its children in the markup. The view reads that nesting and
// hands each row back with what only the view knows: its level, and whether it
// is selected, open, or has anything under it at all.
import { Component } from "mosaic";

import "./outline.css";

// The disclosure chevron, resolved at compile time out of the framework's
// icons — what SvgIconLibrary.getIcon("svg:chevron-right") hands the Java
// version. It points right when shut and is turned by the stylesheet when open.
import ChevronRight from "svg:chevron-right";

/** As far as the stylesheet indents; deeper rows sit at the last step. */
const DEEPEST_LEVEL = 20;

export default class OutlineItem extends Component {
  static props = {
    /** What the row reads. */
    text: { type: String, default: "" },
    /** What the view reports when this row is the selected one. */
    value: { type: String, default: "" },
    /** A font-icon class name, or an icon component, drawn before the text. */
    icon: { type: String },
    /** The same, drawn after it — `setAccessory(Icon)` in Java. */
    accessory: { type: String },

    // --- what the view says, and the markup may state to begin with ------

    /** Whether this row is the selected one. */
    selected: { type: Boolean, default: false },
    /** Whether this row is open. */
    expanded: { type: Boolean, default: false },
    /** Whether it has anything under it to open. */
    expandable: { type: Boolean, default: false },
    /** How deep it sits, which is what the stylesheet indents by. */
    level: { type: Number, default: 0 },
  };

  /** The view this row belongs to, handed down as it is drawn. */
  get outline() {
    return this.get("outline", null);
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * A click on the row selects it; a click on its chevron opens or shuts it
   * instead. The Java version sinks a second listener on `toggleLayer` and
   * stops the event there — the same two outcomes, told apart here by where
   * the click landed, so the row keeps the one listener the base class binds.
   *
   * Either way it stops: a row sits inside its parent row, and a click on a
   * child is not a click on everything above it.
   */
  click(event) {
    event.stopPropagation?.();

    if (this.toggleNode?.contains(event.target)) {
      if (this.expandable) this.outline?.toggle(this.value);
      return;
    }
    this.outline?.select(this.value);
  }

  // --- drawing -------------------------------------------------------------

  /**
   * An icon may be a class name or a component — a compiled `svg:` icon is a
   * function returning a vnode — which is what `setIcon(Icon)` takes in Java.
   *
   * @param {string|Function} icon What to draw.
   * @param {string} slot The class the sheet knows the slot by.
   */
  drawIcon(icon, slot) {
    if (!icon) return <div styleName={slot} aria-hidden="true" />;

    if (typeof icon === "function") {
      const Icon = icon;
      return (
        <div styleName={slot}>
          <Icon aria-hidden="true" />
        </div>
      );
    }
    return <div styleName={[slot, icon]} aria-hidden="true" />;
  }

  /** The rows under this one, which the view has already prepared. */
  drawRows() {
    const children = this.props.children;
    const rows = Array.isArray(children) ? children.flat(Infinity) : [children];
    return rows.filter(Boolean);
  }

  draw() {
    const level = Math.min(this.level, DEEPEST_LEVEL);

    return (
      <li
        styleName={[
          "v-OutlineItem",
          this.expandable ? "expandable" : null,
          this.expanded ? "expanded" : null,
          this.selected ? "selected" : null,
        ]}
        role="treeitem"
        aria-expanded={this.expandable ? String(this.expanded) : null}
        aria-selected={String(this.selected)}
      >
        <div styleName={["content", `level-${level}`]}>
          <div
            styleName="toggle"
            ref={(el) => (this.toggleNode = el)}
            aria-hidden={this.expandable ? null : "true"}
          >
            <ChevronRight aria-hidden="true" />
          </div>

          {this.drawIcon(this.icon, "icon")}
          <span styleName="label">{this.text}</span>
          {this.drawIcon(this.accessory, "accessory")}
        </div>

        <div styleName="collapse">
          <ul styleName="v-Outline-list">{this.drawRows()}</ul>
        </div>
      </li>
    );
  }
}
