// Canvas — a component that is drawn rather than marked up.
//
// It wraps a <canvas> tag and asks its subclass one thing: implement
// `paint(g)`. That is where the drawing happens, onto a {@link Graphics2d},
// which records it as a list of operations; the component flushes that list
// through a {@link CanvasSurface} onto the tag. It is Swing's arrangement —
// override `paint(Graphics)` and never touch the device — and it is here for
// the same reason: painting code that names no canvas can be replayed onto
// something that is not one.
//
//   export default class Dial extends Canvas {
//     static props = { value: {type: Number, default: 0} };
//
//     paint(g) {
//       const {width, height} = this;
//       g.setStroke({width: 8, cap: Cap.ROUND});
//       g.setColor("#dfdfdf");
//       g.drawArc(8, 8, width - 16, height - 16, 225, -270);
//       g.setColor("#1c71d8");
//       g.drawArc(8, 8, width - 16, height - 16, 225, -270 * this.value);
//     }
//   }
//
//   <Dial value="0.6"/>
//
// A repaint happens when the component is attached, when it is resized, and
// whenever one of its declared settings is assigned — `dial.value = 0.8` puts
// the drawing right, the way assigning to a property redraws a marked-up
// component. A component that keeps state somewhere a setting cannot see calls
// `repaint()` itself, which is what `needsDisplay()` means here.
import { Component } from "mosaic";

import CanvasSurface from "./CanvasSurface.js";
import Graphics2d from "./Graphics2d.js";
import "./canvas.css";

export default class Canvas extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Canvas`. See Component.styleName.
   */
  static styleName = "v-Canvas";

  static props = {
    /**
     * How big the drawing surface is, in CSS pixels. Left unset, the canvas
     * fills whatever holds it and is repainted whenever that changes size —
     * which is the usual thing to want, and why there is no default size.
     */
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    /**
     * Whether the surface is wiped before each painting. A component that
     * paints over its last frame on purpose — a sketch pad, a plotter — turns
     * this off and clears when it means to.
     */
    autoClear: { type: Boolean, default: true },
  };

  constructor(controller) {
    super(controller);

    /** The <canvas> tag, once it has been drawn. */
    this.canvasNode = null;

    /** Its 2D context, and the surface that replays drawings onto it. */
    this.ctx = null;
    this.surface = null;

    /** The frame a `repaint()` asked for, so several only ask for one. */
    this.frame = null;

    /** Watching the space the canvas has, when it was given no size. */
    this.observer = null;

    /** How big the surface is, in CSS pixels — what `paint` draws within. */
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;

    /**
     * The last drawing, kept after it was flushed.
     *
     * The point of recording rather than drawing: what a component painted is
     * a value afterwards, so it can be looked at, counted, compared against
     * the next one, or sent somewhere that is not a browser.
     */
    this.ops = [];
  }

  /**
   * The markup, which is a canvas tag and nothing else, and which no subclass
   * overrides — `paint(g)` is what a subclass writes. The tag is the same tag
   * for the life of the component: everything that changes about a Canvas
   * changes inside it, so there is never anything here to patch.
   */
  draw() {
    return (
      <canvas
        styleName="v-Canvas"
        ref={(node) => this.adopt(node)}
        style={{
          width: this.requestedWidth ? `${this.requestedWidth}px` : null,
          height: this.requestedHeight ? `${this.requestedHeight}px` : null,
        }}
      />
    );
  }

  /**
   * Take the tag: hold it, get its context, and build the surface that will
   * replay drawings onto it.
   */
  adopt(node) {
    if (!node || node === this.canvasNode) return;
    this.canvasNode = node;
    this.ctx = node.getContext("2d");
    this.surface = new CanvasSurface(this.ctx);
  }

  /**
   * The size the markup asked for, or zero for each dimension it left to the
   * layout. Distinct from `width`/`height`, which are the size the canvas ended
   * up with — the same thing only when a size was asked for.
   */
  get requestedWidth() {
    return this.get("width", 0);
  }

  get requestedHeight() {
    return this.get("height", 0);
  }

  attached() {
    // A canvas with no size of its own takes the room it is given, and is
    // repainted whenever that changes — a resized window, a dragged divider.
    if (!this.requestedWidth || !this.requestedHeight) {
      if (typeof ResizeObserver === "function") {
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.canvasNode);
      }
    }
    this.resize();
  }

  detached() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /**
   * Match the backing store to the space the tag takes and to the display's
   * pixel ratio, then repaint.
   *
   * The two are different sizes on purpose: the drawing is in CSS pixels,
   * which is what `paint` reasons in, and the buffer beneath it is in device
   * pixels, so a line lands on the pixel grid of the screen it is drawn to
   * rather than being scaled up afterwards. The ratio is applied as a
   * transform before every flush; see {@link Canvas#flush}.
   */
  resize() {
    const node = this.canvasNode;
    if (!node) return;

    // A size assigned after the tag was drawn is written to it here: the
    // markup is drawn once and never patched, so there is nothing else to put
    // the new size on.
    if (this.requestedWidth) node.style.width = `${this.requestedWidth}px`;
    if (this.requestedHeight) node.style.height = `${this.requestedHeight}px`;

    const rect = node.getBoundingClientRect();
    const width = this.requestedWidth || Math.round(rect.width);
    const height = this.requestedHeight || Math.round(rect.height);
    if (width === 0 || height === 0) return;

    const ratio = window.devicePixelRatio || 1;
    const deviceWidth = Math.round(width * ratio);
    const deviceHeight = Math.round(height * ratio);

    // Assigning either of these clears the canvas, so it is only done when
    // one of them has actually changed — a ResizeObserver fires for reasons
    // that are not a change in size.
    if (node.width !== deviceWidth || node.height !== deviceHeight) {
      node.width = deviceWidth;
      node.height = deviceHeight;
    }

    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.repaint();
  }

  /**
   * How wide the drawing is, in the pixels `paint` reasons in: the room the
   * canvas actually has, which is what the markup asked for when it asked for
   * anything.
   *
   * Written by hand rather than left to the setting, because the measured size
   * is the answer and the setting is only ever a request. Assigning one still
   * goes through `set`, so it repaints and anything watching it hears.
   */
  get width() {
    return this.surfaceWidth || this.get("width", 0);
  }

  set width(value) {
    this.set("width", Number(value) || 0);
    this.resize();
  }

  get height() {
    return this.surfaceHeight || this.get("height", 0);
  }

  set height(value) {
    this.set("height", Number(value) || 0);
    this.resize();
  }

  /**
   * What a Canvas does instead of redrawing its markup.
   *
   * The markup is one tag that never changes, so the thing to put right when a
   * setting is assigned is the picture, not the DOM. `Component.set` calls this
   * for every declared setting, which is what makes `dial.value = 0.8` repaint.
   */
  needsDisplay() {
    this.repaint();
  }

  /**
   * Ask for the drawing to be made again, before the next frame.
   *
   * Several asks in one turn cost one painting: a component that assigns three
   * settings in a row, or one that is dragged, paints once per frame however
   * often it is told to.
   */
  repaint() {
    if (this.frame !== null || !this.surface) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paintNow();
    });
  }

  /**
   * Paint immediately, without waiting for a frame — for the caller who has to
   * have the picture right now, an export or a test.
   */
  paintNow() {
    if (!this.surface || this.width === 0 || this.height === 0) return;

    const g = this.createGraphics();
    this.paint(g);
    this.ops = g.ops;
    this.flush(g.ops);
  }

  /**
   * The Graphics2d a painting is recorded into.
   *
   * It is given this canvas's surface to measure text with, so a drawing that
   * asks how wide a string is gets the answer for the device it is going to.
   * A subclass that wants to record a drawing for something other than the
   * screen builds its own and flushes it by hand.
   */
  createGraphics() {
    return new Graphics2d({
      measureText: (text, font) => this.surface.measureText(text, font),
    });
  }

  /**
   * Replay a recorded drawing onto the tag.
   *
   * The transform is set rather than concatenated, so a drawing that left the
   * transform somewhere odd — an unbalanced `save()` — cannot carry that into
   * the next frame. From `paint`'s side the origin is the top-left corner and
   * the unit is a CSS pixel, whatever the display's pixel ratio is.
   */
  flush(ops) {
    const ratio = window.devicePixelRatio || 1;
    const { ctx } = this;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (this.autoClear) ctx.clearRect(0, 0, this.width, this.height);
    this.surface.flush(ops);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Where a pointer event happened, in the coordinates `paint` draws in —
   * which is what a canvas that answers a click needs and cannot get from the
   * event, whose coordinates are the page's.
   *
   *   handleClick(event) {
   *     const {x, y} = this.pointAt(event);
   *     …
   *   }
   */
  pointAt(event) {
    const rect = this.canvasNode.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Where the drawing happens. A Canvas that does not override this is a blank
   * one, which is a mistake worth hearing about rather than a blank rectangle
   * to wonder at.
   *
   * @param {Graphics2d} g The drawing being recorded.
   */
  paint(g) {
    throw new Error(
      `${this.constructor.name} extends Canvas but implements no paint(g) — ` +
        `that is where a Canvas does its drawing.`,
    );
  }
}
