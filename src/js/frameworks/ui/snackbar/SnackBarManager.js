// SnackBarManager: what puts a snackbar on the page,
// stacks it with whatever else is up, and takes it away again.
//
// An application holds one — a page's controller usually keeps it as a field —
// and shows things through it:
//
//   this.bars = new SnackBarManager(SnackBarPosition.BOTTOM_RIGHT);
//   this.bars.toast("Everything was saved", Intent.SUCCESS);
//   this.bars.show(<SavedBar/>);          // a bar of the application's own
//
// It owns a layer it mounts on the body, and the layer draws the bars — so a bar
// is
// drawn the way everything else here is drawn, and the manager only says which
// bars there are.
import { Component, mount } from "mosaic";

import { Intent } from "../controls/button/Button.js";
import { SnackBarAnimationState } from "./SnackBar.js";
import Toast from "./Toast.js";
import "./snackbar.css";

/** Which corner or edge of the window the bars stack against. */
export const SnackBarPosition = Object.freeze({
  TOP_LEFT: "top_left",
  TOP_RIGHT: "top_right",
  TOP_CENTER: "top_center",
  BOTTOM_LEFT: "bottom_left",
  BOTTOM_CENTER: "bottom_center",
  BOTTOM_RIGHT: "bottom_right",
});

/**
 * How long a bar is left where it was placed before it is told to come in. A
 * transition needs the browser to have seen the first state to animate from it.
 */
const ENTER_DELAY = 25;

/**
 * The fixed layer the bars live on. Drawn rather than assembled by hand, so a
 * bar coming or going is a redraw of a list, and the bars already up keep their
 * DOM — and their animations — while it happens.
 */
export class SnackBarLayer extends Component {
  static props = {
    /** The manager whose bars these are. */
    manager: { type: Object },
  };

  /**
   * The edges the layer is pinned to. A centred stack is pinned to both sides
   * at once, which is what centres it — `buildClassName()` in Java.
   */
  layerClasses() {
    const position = this.manager?.position ?? SnackBarPosition.BOTTOM_RIGHT;
    const [side, end] = position.split("_");

    return [
      "v-SnackBar-container",
      side,
      end === "center" ? "left" : end,
      end === "center" ? "right" : null,
    ];
  }

  draw() {
    const bars = this.manager?.bars ?? [];

    return (
      <div styleName={this.layerClasses()} role="presentation">
        {bars.map((entry) => (
          <span key={entry.key}>{entry.vnode}</span>
        ))}
      </div>
    );
  }
}

export default class SnackBarManager {
  /**
   * @param {string} [position] Which edge the bars stack against.
   */
  constructor(position = SnackBarPosition.BOTTOM_RIGHT) {
    /** Where the bars go. Fixed when the manager is made, as it is in Java. */
    this.position = position;

    /** Whether bars slide in and fade out, or simply appear and go. */
    this.allowsAnimation = true;

    /** What is up, oldest first: `{key, vnode, view}` per bar. */
    this.bars = [];

    /** Tells the bars apart from one another across redraws. */
    this.nextKey = 1;
  }

  // --- putting one up ------------------------------------------------------

  /**
   * Show a bar. It is a vnode — `<SavedBar/>`, or `h(Toast, {text})` — which
   * the layer draws; the component itself is built by the drawing, as every
   * other component here is.
   *
   * @param {object} vnode The bar to show.
   * @returns {object} The same vnode, so a caller can hold on to it.
   */
  show(vnode) {
    this.ensureLayer();

    const entry = { key: this.nextKey++, vnode: null, view: null };
    // The bar reports itself as it is drawn, which is when there is
    // something to start the animation on.
    entry.vnode = {
      ...vnode,
      props: { ...vnode.props, ref: (view) => this.barDrawn(entry, view) },
    };

    // The newest bar sits nearest the edge the stack is pinned to: at the
    // top of a top stack, at the end of a bottom one.
    if (this.position.startsWith("top")) this.bars.unshift(entry);
    else this.bars.push(entry);

    this.layer.needsDisplay();
    return vnode;
  }

  /**
   * Show a line of text — the whole of what most callers want.
   *
   * @param {string} text What it says.
   * @param {string} [intent] One of Intent, which decides the face it wears.
   * @param {object} [props] Anything else the toast should carry.
   * @returns {object} The vnode shown.
   */
  toast(text, intent = Intent.DEFAULT, props = {}) {
    return this.show(<Toast text={text} intent={intent} {...props} />);
  }

  /**
   * A bar has been drawn. The first time, it is told whose it is and set going;
   * a ref fires on every redraw, so the rest are nothing new.
   */
  barDrawn(entry, view) {
    if (!view || entry.view === view) return;
    entry.view = view;
    view.manager = this;

    if (!this.allowsAnimation) {
      view.setAnimation(SnackBarAnimationState.APPEAR);
      return;
    }

    // Placed off screen first, then told to come in: a transition needs the
    // browser to have seen where it started from.
    view.setAnimation(SnackBarAnimationState.ENTER);
    setTimeout(
      () => view.setAnimation(SnackBarAnimationState.APPEAR),
      ENTER_DELAY,
    );
  }

  // --- taking them away ----------------------------------------------------

  /**
   * Take a bar off the layer. Called by the bar itself once it has finished
   * going, so a caller closes a bar rather than removing it.
   *
   * @param {object} view The bar's component.
   */
  remove(view) {
    const before = this.bars.length;
    this.bars = this.bars.filter((entry) => entry.view !== view);
    if (this.bars.length !== before) this.layer?.needsDisplay();
  }

  /**
   * Close everything that is up. The bars go the way they would have gone on
   * their own — the Java version hides them where they stand, which leaves
   * them on the page and their close handlers unrun.
   */
  closeAll() {
    for (const entry of [...this.bars]) entry.view?.close();
  }

  /** How many bars are up. */
  get count() {
    return this.bars.length;
  }

  // --- the layer itself ----------------------------------------------------

  /** Put the layer on the page, if it is not there already. */
  ensureLayer() {
    if (this.layer) return this.layer;

    this.host = document.createElement("div");
    document.body.appendChild(this.host);

    this.unmountLayer = mount(SnackBarLayer, this.host, { manager: this });
    this.layer = this.unmountLayer.view;
    return this.layer;
  }

  /** Take the layer off the page altogether, bars and all. */
  dispose() {
    this.bars = [];
    this.unmountLayer?.();
    this.host?.remove();
    this.layer = null;
    this.host = null;
    this.unmountLayer = null;
  }
}
