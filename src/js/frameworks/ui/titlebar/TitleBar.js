// TitleBar, ported from GWT Mosaic (client/components/TitleBar.java): a short
// full-width strip above the toolbar, with document actions against the left
// edge, the title centred on the bar and whoever is signed in against the
// right.
//
// The Java version takes its three regions as `@UiChild` slots. There are no
// slots here, so a child says which region it belongs to and the bar reads it
// — the same arrangement Tab and MenuItem are read by:
//
//   <TitleBar title="Settings">
//       <TitleBarButton slot="actions" text="Back" icon="fa-chevron-left"
//                       action="goBack"/>
//       <SaveStatus/>
//       <TitleBarButton slot="trailing" text="Ada" icon="fa-user"
//                       action="showAccount"/>
//   </TitleBar>
//
// A child that names no slot goes beside the title, which is where the Java
// version's `status` slot put a save pill.
//
// The bar owns only the strip: its height, the rule under it, and where the
// three regions sit. What goes in them is the caller's, and styled by them.
import { Component } from "mosaic";

import "./titlebar.css";

/**
 * Breathing room added to the measured collision width, and the gap kept
 * between the centred title and each side region.
 */
const SIDE_GAP_PX = 16;

/**
 * The title's greatest rendered width — kept in step with the `max-width` on
 * `.v-TitleBar-title`. A longer title ellipsises rather than widening the bar,
 * so its contribution to the minimum is capped here.
 */
const MAX_TITLE_WIDTH_PX = 300;

export default class TitleBar extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `TitleBar`. See Component.styleName.
   */
  static styleName = "v-TitleBar";

  static props = {
    /** The title, centred on the bar. */
    title: { type: String, default: "" },
  };

  constructor() {
    super();

    /** The last minimum width written, so a no-op resize restyles nothing. */
    this.appliedMinWidth = -1;
  }

  // --- the regions ---------------------------------------------------------

  /** Everything the markup put in the bar, as a flat list of vnodes. */
  get children() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter((child) => child !== null && child !== undefined);
  }

  /**
   * The children belonging to one region. `"title"` is the default, so
   * anything that names no slot sits beside the title.
   */
  slot(name) {
    return this.children.filter(
      (child) => (child?.props?.slot ?? "title") === name,
    );
  }

  // --- how narrow the bar may get ------------------------------------------

  attached() {
    // The minimum is recomputed whenever the bar or one of its regions
    // changes size, so the strip stops shrinking exactly where the centred
    // title would meet a side region rather than at a hand-picked constant.
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(() => this.updateMinWidth());
      for (const element of [
        this.node,
        this.actionsNode,
        this.titleNode,
        this.trailingNode,
      ]) {
        if (element) this.observer.observe(element);
      }
    }
    this.updateMinWidth();
  }

  detached() {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Size the bar's `min-width` to the point where the centred title would
   * touch a side region. The title is centred on the bar, so each side has to
   * clear the wider of the two: `title + 2 * max(actions, trailing)`, plus a
   * gap. Below that the strip scrolls rather than letting the trailing button
   * overlap the title.
   */
  updateMinWidth() {
    const bar = this.node;
    if (!bar) return;

    const actions = this.actionsNode?.offsetWidth ?? 0;
    const trailing = this.trailingNode?.offsetWidth ?? 0;
    // scrollWidth is the title's natural, untruncated width: unaffected by
    // the max-width clamp and by the minimum written here, so this cannot
    // feed back into itself. Capped at what the title may render as, so a
    // long ellipsised one does not force the bar wider.
    const title = Math.min(
      this.titleNode?.scrollWidth ?? 0,
      MAX_TITLE_WIDTH_PX,
    );

    const side = Math.max(actions, trailing) + SIDE_GAP_PX;
    const minWidth = title + 2 * side;
    if (minWidth === this.appliedMinWidth) return;
    this.appliedMinWidth = minWidth;
    bar.style.minWidth = `${minWidth}px`;
  }

  // --- drawing -------------------------------------------------------------

  // The title carries its full text as a hover tooltip, since a long one is
  // cut with an ellipsis rather than widening the bar.
  draw() {
    const title = this.title;

    return (
      <div styleName="v-TitleBar">
        <div
          styleName="v-TitleBar-actions"
          ref={(element) => (this.actionsNode = element)}
        >
          {this.slot("actions")}
        </div>

        <div
          styleName="v-TitleBar-title"
          ref={(element) => (this.titleNode = element)}
        >
          <span
            styleName="v-TitleBar-label"
            title={title || null}
            style={{ display: title ? "" : "none" }}
          >
            {title}
          </span>
          {this.slot("title")}
        </div>

        <div
          styleName="v-TitleBar-trailing"
          ref={(element) => (this.trailingNode = element)}
        >
          {this.slot("trailing")}
        </div>
      </div>
    );
  }
}
