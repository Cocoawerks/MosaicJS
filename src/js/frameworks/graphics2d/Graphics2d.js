// Graphics2d — the drawing surface a component paints onto, and the thing that
// makes the drawing a value.
//
// Nothing here draws. Every method appends an operation to a list, and the list
// is the drawing: an intermediate representation of two-dimensional graphics,
// in the shape Java2D describes them, made of numbers and strings and nothing
// else. Something else replays it — CanvasSurface does, onto a
// CanvasRenderingContext2D; a Java2D surface will, onto a `java.awt.Graphics2D`
// — and neither the painting code nor this class knows which.
//
//   paint(g) {
//     g.setColor("#1c71d8");
//     g.fillRoundRect(8, 8, 120, 40, 8, 8);
//     g.setColor("white");
//     g.setFont("13px system-ui");
//     g.drawString("Hello", 20, 33);
//   }
//
// The API is Java2D's, deliberately: `drawOval` takes the box the oval is
// inscribed in, `drawArc` measures degrees anticlockwise from three o'clock,
// `drawString` puts the text's baseline at the point it is given, and one paint
// serves both the drawing and the filling. Where the two worlds disagree, this
// side speaks Java and the surface translates.
import { Cap, Join, Op, WindingRule } from "./ops.js";
import Path from "./Path.js";

export { Cap, Join, Op, WindingRule, Path };

/** The state a fresh Graphics2d starts in — AWT's defaults, near enough. */
const DEFAULTS = Object.freeze({
  paint: "#000000",
  font: "12px system-ui, sans-serif",
  alpha: 1,
});

export default class Graphics2d {
  /**
   * @param {object} [options]
   * @param {(text: string, font: string) => number} [options.measureText]
   *   How to find out how wide a string is. Measuring is the one question a
   *   drawing can ask, and it cannot be answered by a list of operations — the
   *   answer depends on a font as some particular device has it. A surface
   *   supplies this; see {@link Graphics2d#stringWidth}. Without one, widths
   *   are estimated, which is enough to lay something out roughly and not
   *   enough to centre it.
   */
  constructor({ measureText } = {}) {
    /**
     * The drawing so far: the operations stack, in the order they were made.
     * Read it, hand it to a surface, keep it — but treat it as finished; a
     * Graphics2d is meant to be filled once and replayed, not edited.
     */
    this.ops = [];

    /**
     * The current state, which the recorder tracks as well as records. A
     * surface applies state operations as it meets them, so it needs no state
     * of its own; this copy is here so that `getPaint()` and `stringWidth()`
     * can answer without replaying anything.
     */
    this.state = { ...DEFAULTS };

    /** The stack {@link Graphics2d#save} pushes that state onto. */
    this.stack = [];

    this.measureText = measureText ?? null;
  }

  /** Append an operation. Everything below this line goes through here. */
  push(op, fields) {
    this.ops.push(fields ? { op, ...fields } : { op });
    return this;
  }

  /** Forget the drawing and start again, keeping the measurer. */
  reset() {
    this.ops = [];
    this.state = { ...DEFAULTS };
    this.stack = [];
    return this;
  }

  /** How many operations the drawing came to — useful when tuning one. */
  get length() {
    return this.ops.length;
  }

  // ---- State ------------------------------------------------------------

  /**
   * Push the whole graphics state: paint, stroke, font, alpha, composite,
   * transform and clip. `restore()` pops it.
   *
   * This is the only way back from a clip or a transform, so anything that
   * clips or transforms should bracket itself:
   *
   *   g.save();
   *   g.translate(x, y);
   *   …
   *   g.restore();
   */
  save() {
    this.stack.push({ ...this.state });
    return this.push(Op.SAVE);
  }

  restore() {
    if (this.stack.length > 0) this.state = this.stack.pop();
    return this.push(Op.RESTORE);
  }

  /**
   * What both drawing and filling use.
   *
   * One paint for both, as Java2D has it, rather than Canvas's separate
   * `strokeStyle` and `fillStyle`. A drawing that wants an outline in one
   * colour and a fill in another says so by setting the colour twice, which is
   * what the Java original would do.
   *
   * `setColor` for a colour and {@link Graphics2d#setPaint} for a gradient —
   * the same method under two names, as `java.awt.Graphics2D` has it. Nearly
   * every drawing sets colours, so that is the name to reach for; the operation
   * they both record is `setPaint`, because the field can hold either and an
   * operation named for a colour should not be found carrying a gradient.
   */
  setColor(color) {
    return this.setPaint(color);
  }

  /**
   * The general one: a CSS colour string, or a gradient from
   * {@link linearGradient} / {@link radialGradient}.
   */
  setPaint(paint) {
    this.state.paint = paint;
    return this.push(Op.SET_PAINT, { paint });
  }

  getPaint() {
    return this.state.paint;
  }

  /**
   * How lines are drawn — a BasicStroke.
   *
   * Either a width on its own, `g.setStroke(2)`, or the whole of it:
   *
   *   g.setStroke({width: 2, cap: Cap.ROUND, join: Join.ROUND, dash: [4, 4]});
   */
  setStroke(stroke) {
    const spec =
      typeof stroke === "number" ? { width: stroke } : (stroke ?? {});
    const resolved = {
      width: spec.width ?? 1,
      cap: spec.cap ?? Cap.BUTT,
      join: spec.join ?? Join.MITER,
      miterLimit: spec.miterLimit ?? 10,
      dash: spec.dash ?? null,
      dashPhase: spec.dashPhase ?? 0,
    };
    this.state.stroke = resolved;
    return this.push(Op.SET_STROKE, resolved);
  }

  getStroke() {
    return this.state.stroke;
  }

  /**
   * The font strings are drawn in, as a CSS font shorthand:
   * `"bold 14px system-ui"`. A Java surface takes it apart into a
   * `java.awt.Font`; a Canvas one hands it over as it stands.
   */
  setFont(font) {
    this.state.font = font;
    return this.push(Op.SET_FONT, { font });
  }

  getFont() {
    return this.state.font;
  }

  /** How opaque everything drawn from here on is, 0 to 1. */
  setAlpha(alpha) {
    this.state.alpha = alpha;
    return this.push(Op.SET_ALPHA, { alpha });
  }

  /** The blend rule — `"source-over"`, `"multiply"`, and the rest. */
  setComposite(composite) {
    this.state.composite = composite;
    return this.push(Op.SET_COMPOSITE, { composite });
  }

  /**
   * Where a string sits relative to the point it is drawn at: `"left"`,
   * `"center"`, `"right"`. Java2D has no such thing — it measures and offsets —
   * so a Java surface will do the measuring itself.
   */
  setTextAlign(align) {
    this.state.textAlign = align;
    return this.push(Op.SET_TEXT_ALIGN, { align });
  }

  /** And vertically: `"alphabetic"`, `"top"`, `"middle"`, `"bottom"`. */
  setTextBaseline(baseline) {
    this.state.textBaseline = baseline;
    return this.push(Op.SET_TEXT_BASELINE, { baseline });
  }

  // ---- Transform --------------------------------------------------------

  translate(x, y) {
    return this.push(Op.TRANSLATE, { x, y });
  }

  scale(sx, sy = sx) {
    return this.push(Op.SCALE, { sx, sy });
  }

  /** Radians. About the origin, or about (x, y) when a point is given. */
  rotate(theta, x = null, y = null) {
    return this.push(Op.ROTATE, { theta, x, y });
  }

  shear(shx, shy) {
    return this.push(Op.SHEAR, { shx, shy });
  }

  /** Concatenate [a, b, c, d, e, f] onto the current transform. */
  transform(a, b, c, d, e, f) {
    return this.push(Op.TRANSFORM, { m: [a, b, c, d, e, f] });
  }

  /** Replace it outright. */
  setTransform(a, b, c, d, e, f) {
    return this.push(Op.SET_TRANSFORM, { m: [a, b, c, d, e, f] });
  }

  // ---- Clip -------------------------------------------------------------

  /**
   * Narrow the clip to this rectangle — intersected with whatever the clip
   * already was, as Java2D's `clipRect` is. Widening it again is `restore()`.
   */
  clipRect(x, y, width, height) {
    return this.push(Op.CLIP_RECT, { x, y, width, height });
  }

  /** The same, against a path. */
  clip(path, rule = WindingRule.NON_ZERO) {
    return this.push(Op.CLIP_PATH, { path: path.segments, rule });
  }

  // ---- Shapes -----------------------------------------------------------

  drawLine(x1, y1, x2, y2) {
    return this.push(Op.DRAW_LINE, { x1, y1, x2, y2 });
  }

  drawRect(x, y, width, height) {
    return this.push(Op.DRAW_RECT, { x, y, width, height });
  }

  fillRect(x, y, width, height) {
    return this.push(Op.FILL_RECT, { x, y, width, height });
  }

  /** Erase a rectangle back to nothing — transparent here, the background in AWT. */
  clearRect(x, y, width, height) {
    return this.push(Op.CLEAR_RECT, { x, y, width, height });
  }

  /**
   * `arcWidth` and `arcHeight` are the full width and height of the ellipse the
   * corners are cut from, as Java2D means them — twice the corner radius.
   */
  drawRoundRect(x, y, width, height, arcWidth, arcHeight = arcWidth) {
    return this.push(Op.DRAW_ROUND_RECT, {
      x,
      y,
      width,
      height,
      arcWidth,
      arcHeight,
    });
  }

  fillRoundRect(x, y, width, height, arcWidth, arcHeight = arcWidth) {
    return this.push(Op.FILL_ROUND_RECT, {
      x,
      y,
      width,
      height,
      arcWidth,
      arcHeight,
    });
  }

  /** The oval inscribed in this box — a circle when the box is square. */
  drawOval(x, y, width, height) {
    return this.push(Op.DRAW_OVAL, { x, y, width, height });
  }

  fillOval(x, y, width, height) {
    return this.push(Op.FILL_OVAL, { x, y, width, height });
  }

  /**
   * A slice of that oval, `start` degrees round from three o'clock and running
   * `extent` degrees anticlockwise — Java2D's convention, kept even though the
   * canvas underneath measures the other way.
   */
  drawArc(x, y, width, height, start, extent) {
    return this.push(Op.DRAW_ARC, { x, y, width, height, start, extent });
  }

  /** The same slice, filled as a pie wedge back to the centre. */
  fillArc(x, y, width, height, start, extent) {
    return this.push(Op.FILL_ARC, { x, y, width, height, start, extent });
  }

  drawPolyline(xs, ys) {
    return this.push(Op.DRAW_POLYLINE, { xs, ys });
  }

  drawPolygon(xs, ys) {
    return this.push(Op.DRAW_POLYGON, { xs, ys });
  }

  fillPolygon(xs, ys) {
    return this.push(Op.FILL_POLYGON, { xs, ys });
  }

  /** Outline a {@link Path}. Java2D's `draw(Shape)`. */
  draw(path) {
    return this.push(Op.DRAW_PATH, { path: path.segments });
  }

  /** Fill one. Java2D's `fill(Shape)`. */
  fill(path, rule = WindingRule.NON_ZERO) {
    return this.push(Op.FILL_PATH, { path: path.segments, rule });
  }

  // ---- Text -------------------------------------------------------------

  /** Draw a string with its baseline origin at (x, y). */
  drawString(text, x, y) {
    return this.push(Op.DRAW_STRING, { text: String(text), x, y });
  }

  /**
   * How wide a string would be in the current font.
   *
   * The one thing a drawing asks rather than says, and so the one place the IR
   * leaks: the answer depends on a font as some particular device has it, and
   * cannot come out of a list of operations. The surface that will replay the
   * drawing supplies the measurer, so the answer is the right one for the
   * device being drawn to.
   *
   * With no measurer to hand — a drawing recorded for its own sake, or a test —
   * this estimates from the font size, which is enough to lay something out
   * roughly and not enough to centre it. Use {@link Graphics2d#setTextAlign}
   * for centring; that one the surface can honour exactly.
   */
  stringWidth(text) {
    const string = String(text);
    if (this.measureText) return this.measureText(string, this.state.font);
    const size = Number.parseFloat(this.state.font) || 12;
    return string.length * size * 0.5;
  }

  // ---- Images -----------------------------------------------------------

  /**
   * Draw a picture, in any of the three ways Canvas and Java2D both allow:
   *
   *   g.drawImage(img, x, y);
   *   g.drawImage(img, x, y, width, height);
   *   g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
   *
   * `image` is the one value in the IR that is not plain data — it is whatever
   * the surface understands as a picture. A drawing meant to be written down
   * and replayed elsewhere should pass a name and let the surface resolve it.
   */
  drawImage(image, ...args) {
    if (args.length === 8) {
      const [sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight] = args;
      return this.push(Op.DRAW_IMAGE, {
        image,
        sx,
        sy,
        sWidth,
        sHeight,
        dx,
        dy,
        dWidth,
        dHeight,
      });
    }
    const [dx, dy, dWidth = null, dHeight = null] = args;
    return this.push(Op.DRAW_IMAGE, { image, dx, dy, dWidth, dHeight });
  }
}

/**
 * A paint that runs from one colour to another along a line.
 *
 * `stops` is `[[offset, colour], …]` with offsets from 0 to 1 — or a pair of
 * colours, which is the common case spelled short.
 *
 *   g.setPaint(linearGradient(0, 0, 0, 64, "#1c71d8", "#0b3d91"));
 */
export function linearGradient(x0, y0, x1, y1, ...stops) {
  return { type: "linear", x0, y0, x1, y1, stops: normalizeStops(stops) };
}

/** The same, radiating out between two circles. */
export function radialGradient(x0, y0, r0, x1, y1, r1, ...stops) {
  return {
    type: "radial",
    x0,
    y0,
    r0,
    x1,
    y1,
    r1,
    stops: normalizeStops(stops),
  };
}

/**
 * `("a", "b")` and `([[0, "a"], [1, "b"]])` mean the same thing: two colours
 * with no offsets are spread evenly from one end to the other.
 */
function normalizeStops(stops) {
  const given = stops.length === 1 && Array.isArray(stops[0]) ? stops[0] : stops;
  if (given.every((stop) => Array.isArray(stop))) return given;
  const last = given.length - 1;
  return given.map((color, i) => [last === 0 ? 0 : i / last, color]);
}
