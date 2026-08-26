// SplitView: two panes with a draggable divider between them.
// Named for what the framework calls things that hold a view apiece — ListView,
// OutlineView, TabView, DeckView.
// One pane is elastic and takes whatever room is left; the other is the static
// one, and its length is what the divider changes. `flex` says which is which. A
// child says which pane it belongs to and the view reads it — the arrangement
// TitleBar, DialogBox and MenuItem are read by. A child that names neither goes
// in the top-left pane, which is the one a single child means.
import { Component } from "mosaic";

import { Orientation } from "../controls/slider/AbstractSlider.js";
import "./split.css";

export { Orientation };

/** Which pane is elastic — `SplitPanelFlex.java`, whose names these are. */
export const SplitViewFlex = Object.freeze({
  /** The top or left pane stretches; the other one's length is set. */
  TOP_LEFT: "top_left",
  /** The bottom or right pane stretches. */
  BOTTOM_RIGHT: "bottom_right",
});

/** How thick the divider is unless it is told otherwise. */
const DEFAULT_THICKNESS = 13;

/** How long the static pane is unless it is told otherwise. */
const DEFAULT_LENGTH = 200;

/**
 * A divider thinner than this is a hairline rather than a grip: it loses its
 * sash and takes a hover line instead. `thickness < 2` in Java.
 */
const HAIRLINE = 2;

/** How much of the divider's thickness the sash takes up. */
const SASH_RATIO = 0.55;

/**
 * How long a press must be held before the divider shows itself as held. A
 * press that turns straight into a drag is already telling the reader what is
 * happening; this is for the one that rests there — `invokeLater(…, 400)`.
 */
const ACTIVE_DELAY = 400;

/**
 * Take and give back the pointer, forgivingly — the same pair AbstractSlider
 * keeps, and for the same reason: both throw over a pointer that is no longer
 * about, and neither is worth failing a drag over.
 */
function capturePointer(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    // The pointer is gone; the drag carries on without capture.
  }
}

function releasePointer(element, pointerId) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    // Nothing was captured, so there is nothing to give back.
  }
}

/**
 * @fires SplitView#action — the divider was dragged; the handler is given the
 *   split view and the new pane length. Bound bare: `action="method"`
 *   (`onAction` in JS).
 */
export default class SplitView extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `SplitView`. See Component.styleName.
   */
  static styleName = "v-SplitView";

  static props = {
    /** Which way the panes sit — one of Orientation. */
    orientation: { type: String, default: Orientation.HORIZONTAL },
    /** Which pane stretches — one of SplitViewFlex. */
    flex: { type: String, default: SplitViewFlex.TOP_LEFT },
    /** How thick the divider is, in pixels. */
    dividerThickness: { type: Number, default: DEFAULT_THICKNESS },
    /**
     * How long the static pane is, in pixels. Declared here so markup can say
     * it and it arrives as a number, but the accessor below is written by hand
     * — assigning it has to lay the panes out, and a drag assigns it every
     * frame.
     */
    staticPaneLength: { type: Number, default: DEFAULT_LENGTH },
    /** How short the static pane may be dragged. */
    minStaticPaneLength: { type: Number, default: 0 },
    /** And how long. Unset means as long as there is room for. */
    maxStaticPaneLength: { type: Number, default: Number.MAX_VALUE },
  };

  constructor(props) {
    super(props);

    /**
     * How long the static pane has been set to, or null while the length the
     * markup asked for still stands.
     *
     * Kept beside the setting rather than in it, because this is what a drag
     * changes: assigning a setting repaints, and a drag assigns every frame —
     * which would redraw both panes, and everything an application put in
     * them, per frame. The length is written to the panes instead; see
     * {@link SplitView#layout}.
     */
    this.assignedLength = null;

    /** Whether the static pane is shut away. */
    this.collapsed = false;

    /** How long it was before it was shut, so expanding puts it back. */
    this.preCollapseLength = null;

    /** Where the drag started, and how long the static pane was then. */
    this.startLength = 0;
    this.startPoint = null;
    this.dragging = false;
  }

  /**
   * How long the static pane has been asked to be: whatever was last assigned,
   * or what the markup said until something is.
   */
  get staticPaneLength() {
    return this.assignedLength ?? this.get("staticPaneLength", DEFAULT_LENGTH);
  }

  set staticPaneLength(value) {
    this.setStaticPaneLength(Number(value));
  }

  /** The same, as the length it resolves to: clamped, and 0 when shut. */
  get paneLength() {
    if (this.collapsed) return 0;
    return Math.max(
      this.minStaticPaneLength,
      Math.min(this.staticPaneLength, this.maxStaticPaneLength),
    );
  }

  /**
   * Set how long the static pane is and lay the panes out again. Written to
   * the DOM rather than drawn — this is the path a drag takes.
   */
  setStaticPaneLength(value) {
    if (!Number.isFinite(value)) return;
    this.assignedLength = value;
    this.layout();
    // How long the pane is is worked out from what was assigned and the room
    // there is, so nothing assigned `paneLength` and a binding onto it would
    // sit still through a whole drag.
    this.changed("paneLength");
    this.props.action?.(this.self, this.paneLength);
  }

  // --- shutting the static pane away ----------------------------------------

  /** Shut the static pane, remembering how long it was. */
  collapse() {
    if (this.collapsed) return;
    this.preCollapseLength = this.staticPaneLength;
    this.collapsed = true;
    this.assignedLength = 0;
    this.changed("paneLength");
    // Drawn, not written: `collapsed` is a class, and a class put on by hand
    // is wiped by the next redraw.
    this.needsDisplay();
    this.layout();
    this.reportCollapsed(true);
  }

  /** Open it again, as long as it was. */
  expand() {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.assignedLength = this.preCollapseLength;
    this.changed("paneLength");
    this.needsDisplay();
    this.layout();
    this.reportCollapsed(false);
  }

  toggle() {
    if (this.collapsed) this.expand();
    else this.collapse();
  }

  /** Say that the static pane was shut, or opened. */
  reportCollapsed(collapsed) {
    (collapsed ? this.props.onCollapse : this.props.onExpand)?.(this.self);
  }

  // --- laying the panes out --------------------------------------------------

  attached() {
    this.layout();
  }

  /** Whether the panes sit side by side rather than one above the other. */
  get horizontal() {
    return this.orientation !== Orientation.VERTICAL;
  }

  /** Whether the top-left pane is the elastic one. */
  get flexesTopLeft() {
    return this.flex !== SplitViewFlex.BOTTOM_RIGHT;
  }

  /**
   * Size the two panes: one takes the length, the other takes what is left.
   *
   * Written to the elements rather than drawn, for the reason `length` is a
   * field — a drag would otherwise redraw everything in both panes per frame.
   * The panes are the view's own wrappers, so nothing here reaches into what
   * an application put inside them.
   */
  layout() {
    const stretch = this.flexesTopLeft
      ? this.topLeftNode
      : this.bottomRightNode;
    const fixed = this.flexesTopLeft ? this.bottomRightNode : this.topLeftNode;
    if (!stretch || !fixed) return;

    const length = `${this.paneLength}px`;
    stretch.style.flex = "1";
    fixed.style.flex = "unset";

    if (this.horizontal) {
      fixed.style.width = length;
      fixed.style.height = "100%";
      stretch.style.height = "100%";
    } else {
      fixed.style.height = length;
      fixed.style.width = "100%";
      stretch.style.width = "100%";
    }
  }

  // --- the divider -----------------------------------------------------------

  /** How big the sash is, and how far in from the divider's edge it sits. */
  get sashSize() {
    return this.dividerThickness * SASH_RATIO;
  }

  get sashOffset() {
    return (this.dividerThickness - this.sashSize - 2) / 2;
  }

  /**
   * Whether the divider can be dragged at all. A shut pane has no divider to
   * speak of, a hairline over a pane of no length has nothing to take hold of,
   * and a pane whose bounds meet has nowhere to go.
   */
  get dividerEnabled() {
    if (this.collapsed) return false;
    if (this.dividerThickness === 1 && this.paneLength === 0) return false;
    return this.minStaticPaneLength !== this.maxStaticPaneLength;
  }

  /** A press on the divider: remember where it started from. */
  dividerPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (!this.dividerEnabled) return;
    event.preventDefault?.();

    this.dragging = true;
    this.startLength = this.paneLength;
    this.startPoint = { x: event.clientX, y: event.clientY };
    capturePointer(this.dividerNode, event.pointerId);

    // Held rather than dragged: the divider says so after a moment.
    this.activeTimer = setTimeout(() => {
      this.activeTimer = null;
      this.dividerNode?.classList?.add("is-active");
    }, ACTIVE_DELAY);
  }

  /**
   * A drag. Which way the length runs depends on which pane is elastic: with
   * the top-left one stretching, the static pane is the far one, and dragging
   * towards it makes it shorter.
   */
  dividerPointerMove(event) {
    if (!this.dragging || !this.startPoint) return;

    const sign = this.flexesTopLeft ? -1 : 1;
    const delta = this.horizontal
      ? event.clientX - this.startPoint.x
      : event.clientY - this.startPoint.y;

    this.setStaticPaneLength(this.startLength + sign * delta);
  }

  dividerPointerUp(event) {
    releasePointer(this.dividerNode, event?.pointerId);
    clearTimeout(this.activeTimer);
    this.activeTimer = null;
    this.dividerNode?.classList?.remove("is-active");
    this.dragging = false;
    this.startPoint = null;
  }

  detached() {
    clearTimeout(this.activeTimer);
    this.activeTimer = null;
  }

  // --- what it holds ---------------------------------------------------------

  /** Everything the markup put in it, flattened. */
  get children() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter((child) => child !== null && child !== undefined);
  }

  /**
   * The children belonging to one pane. `"topLeft"` is the default, so a view
   * given one child puts it in the pane that comes first.
   */
  slot(name) {
    return this.children.filter(
      (child) => (child?.props?.slot ?? "topLeft") === name,
    );
  }

  // --- drawing ---------------------------------------------------------------

  viewClasses() {
    return [
      "v-SplitView",
      this.horizontal ? "row" : "column",
      this.collapsed ? "collapsed" : null,
    ];
  }

  dividerClasses() {
    return ["v-SplitDivider", this.dividerThickness < HAIRLINE ? "thin" : null];
  }

  /**
   * The divider's own size, and the sash's within it. Drawn rather than
   * written: unlike the panes' lengths these change only when the view is
   * told something, never during a drag.
   */
  dividerStyle() {
    if (this.collapsed) return { width: "0", height: "0" };
    const thickness = `${this.dividerThickness}px`;
    return {
      width: this.horizontal ? thickness : "100%",
      height: this.horizontal ? "100%" : thickness,
      pointerEvents: this.dividerEnabled ? null : "none",
    };
  }

  sashStyle() {
    const size = `${this.sashSize}px`;
    const offset = `${this.sashOffset}px`;
    return {
      top: this.horizontal ? "50%" : offset,
      left: this.horizontal ? offset : "50%",
      width: size,
      height: size,
    };
  }

  draw() {
    return (
      <div styleName={this.viewClasses()}>
        <div
          styleName="v-SplitView-pane"
          ref={(node) => (this.topLeftNode = node)}
        >
          {this.slot("topLeft")}
        </div>

        <div
          styleName={this.dividerClasses()}
          style={this.dividerStyle()}
          role="separator"
          aria-orientation={this.horizontal ? "vertical" : "horizontal"}
          ref={(node) => (this.dividerNode = node)}
          onpointerdown={(event) => this.dividerPointerDown(event)}
          onpointermove={(event) => this.dividerPointerMove(event)}
          onpointerup={(event) => this.dividerPointerUp(event)}
          onpointercancel={(event) => this.dividerPointerUp(event)}
        >
          <b styleName="v-Sash" style={this.sashStyle()} />
        </div>

        <div
          styleName="v-SplitView-pane"
          ref={(node) => (this.bottomRightNode = node)}
        >
          {this.slot("bottomRight")}
        </div>
      </div>
    );
  }
}
