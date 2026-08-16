// OutlineView, ported from GWT Mosaic (client/components/OutlineView.java and
// OutlineObject.java, with resources/outline/OutlineView.ui.xml): a tree of
// disclosable rows, one of which is selected.
//
// The view owns two things and the items own neither: which row is selected,
// and which rows are open. That is what OutlineView.java does too — an item
// asks `outlineView.selectedItem` rather than keeping its own — and it is the
// arrangement RadioGroup already uses here, so an item never has to know about
// its siblings.
//
// In markup the tree is the nesting:
//
//   <OutlineView outlet="places" action="chosen" value="inbox">
//       <OutlineItem text="Mail" value="mail" expanded="true">
//           <OutlineItem text="Inbox" value="inbox"/>
//           <OutlineItem text="Sent" value="sent"/>
//       </OutlineItem>
//       <OutlineItem text="Files" value="files"/>
//   </OutlineView>
//
// OutlineObject — the abstract base the Java version puts the child list on —
// has no counterpart here. Its whole job is holding the items added to a node
// and handing them their parent; in Mosaic the markup's nesting is that list
// already, so the view reads the tree it was given rather than being told about
// it a widget at a time.
import { coerceProps, Component } from "mosaic";

import OutlineItem from "./OutlineItem.js";
import "./outline.css";

export default class OutlineView extends Component {
  constructor() {
    super();

    /**
     * The values of the rows that are open.
     *
     * A field rather than a setting: it is mutated in place, and what
     * follows a change is stated by the call to `needsDisplay()` next to it.
     *
     * @type {Set<string>}
     */
    this.expandedValues = new Set();

    /** Whether the markup's own `expanded` and `selected` have been read. */
    this.awakened = false;
  }

  // --- selection -----------------------------------------------------------

  /** The value of the selected row, or "" while nothing is selected. */
  get value() {
    return this.get("value", "");
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Select the row carrying `value`, and say whether that counts as the user
   * selecting it. `setValue(v, true)` fires the action, as
   * `SelectionEvent.fire` does in Java; assigning to `value` does not.
   */
  setValue(value, fireEvents = false) {
    const next = value ?? "";
    if (this.value === next) return;

    this.set("value", next);
    this.needsDisplay();
    if (fireEvents) this.fireSelection(next);
  }

  /**
   * Tell whoever is listening that a row was selected — `SelectionEvent.fire`
   * in Java, and what `action` names in markup:
   *
   *   <OutlineView action="chosen"/>
   *
   * `self` rather than `this`: a drawing runs against a proxy that records
   * what it read, and what arrives at the handler should be the view.
   */
  fireSelection(value) {
    const view = this.self;
    view.props.action?.(view, value, view.selectedItem);
  }

  /**
   * The selected row as the markup stated it — `{value, text, level, …}` —
   * or null when nothing is selected. `getSelectedItem()` in Java, which
   * returns the widget; here the rows are markup, so this is what there is to
   * hand back.
   */
  get selectedItem() {
    return this.visibleItems().find((row) => row.value === this.value) ?? null;
  }

  // --- disclosure ----------------------------------------------------------

  /** Whether the row carrying `value` is open. */
  isExpanded(value) {
    return this.expandedValues.has(value);
  }

  /** Open the row carrying `value`, or shut it. `expand`/`collapse` in Java. */
  setExpanded(value, expanded) {
    if (expanded) this.expandedValues.add(value);
    else this.expandedValues.delete(value);
    this.needsDisplay();
  }

  /** Shut an open row, open a shut one. */
  toggle(value) {
    this.setExpanded(value, !this.isExpanded(value));
  }

  /** Open every row that has anything under it. */
  expandAll() {
    for (const row of this.allItems()) {
      if (row.items.length > 0) this.expandedValues.add(row.value);
    }
    this.needsDisplay();
  }

  /** Shut every row. */
  collapseAll() {
    this.expandedValues.clear();
    this.needsDisplay();
  }

  // --- the tree the markup states ------------------------------------------

  /**
   * The rows among `children`, read from the vnodes rather than from any
   * component: these are read before a row is drawn, so their props have not
   * been through one yet, and this is where `expanded="true"` becomes true.
   *
   * Each row is `{value, text, level, props, vnode, items}`; `items` are its
   * own rows, read the same way. A vnode keeps its children beside its props
   * rather than among them — `h(type, props, ...children)` — which is why a
   * row's own rows are taken from `vnode.children`.
   */
  rowsUnder(children, level = 0) {
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];

    return list
      .filter((child) => child && child.type === OutlineItem)
      .map((child) => {
        const props = coerceProps(child.props);
        // A row is known by its value; failing that, by what it reads,
        // so markup that names neither still gets a working tree.
        const value = String(props.value ?? props.text ?? "");
        return {
          value,
          text: props.text ?? "",
          level,
          props,
          vnode: child,
          items: this.rowsUnder(child.children, level + 1),
        };
      });
  }

  /** The rows stated directly under the view. */
  get rows() {
    return this.rowsUnder(this.props.children);
  }

  /** Every row in the tree, open or shut, in the order they are written. */
  allItems(rows = this.rows, into = []) {
    for (const row of rows) {
      into.push(row);
      this.allItems(row.items, into);
    }
    return into;
  }

  /**
   * The rows that can be seen, top to bottom: a shut row's own rows are not
   * among them.
   *
   * This is what the arrow keys move through. OutlineView.java walks the tree
   * by hand — down into an open row, on to the next sibling, or up until an
   * ancestor has one — which is this order, one step at a time.
   */
  visibleItems(rows = this.rows, into = []) {
    for (const row of rows) {
      into.push(row);
      if (this.isExpanded(row.value)) this.visibleItems(row.items, into);
    }
    return into;
  }

  /**
   * Read what the markup said about the rows, once: which start open and
   * which starts selected.
   *
   * Left until the first drawing rather than done in the constructor, because
   * a component has no props before then — and read once, because what is
   * read here is state the view goes on to own: reading it again would shut a
   * row the user had opened.
   */
  awake() {
    if (this.awakened) return;
    this.awakened = true;

    for (const row of this.allItems()) {
      if (row.props.expanded === true) this.expandedValues.add(row.value);
      if (row.props.selected === true && !this.get("value", "")) {
        this.overrides.value = row.value;
      }
    }
  }

  // --- behaviour -----------------------------------------------------------

  /**
   * A row was clicked, or its toggle was. An item reports; the view decides —
   * `setSelected` goes through `outlineView` in the Java version too.
   */
  select(value) {
    this.setValue(value, true);
  }

  /**
   * The keys OutlineView.java handles: the arrows move the selection through
   * what can be seen, and the space bar opens or shuts the selected row.
   */
  keyDown(event) {
    const visible = this.visibleItems();
    const index = visible.findIndex((row) => row.value === this.value);

    switch (event.key) {
      case " ":
      case "Spacebar": {
        event.preventDefault?.();
        const row = visible[index];
        if (row && row.items.length > 0) this.toggle(row.value);
        break;
      }
      case "ArrowUp":
      case "Up":
        event.preventDefault?.();
        // From nothing, the last row; the Java version starts at the
        // view and steps back from there.
        if (index > 0) this.setValue(visible[index - 1].value, true);
        else if (index === -1 && visible.length > 0) {
          this.setValue(visible[visible.length - 1].value, true);
        }
        break;
      case "ArrowDown":
      case "Down":
        event.preventDefault?.();
        if (index + 1 < visible.length) {
          this.setValue(visible[index + 1].value, true);
        }
        break;
      default:
    }
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The rows, each told where it sits and how to report back. What the markup
   * said about a row is kept — that is the row's business — and what only the
   * view knows is added.
   *
   * The whole tree is prepared here, not a level at a time: a row's own rows
   * are its vnode's children, and a row cannot say what its children's level
   * or selection is, because it is not what holds either.
   */
  drawRows(rows) {
    return rows.map((row) => ({
      ...row.vnode,
      props: {
        ...row.props,
        key: row.value,
        outline: this.self,
        level: row.level,
        selected: row.value === this.value,
        expanded: this.isExpanded(row.value),
        expandable: row.items.length > 0,
      },
      children: this.drawRows(row.items),
    }));
  }

  draw() {
    this.awake();

    return (
      <div styleName="v-OutlineView" role="tree" tabindex="0">
        <div styleName="collapse">
          <ul styleName="v-Outline-list">{this.drawRows(this.rows)}</ul>
        </div>
      </div>
    );
  }
}
