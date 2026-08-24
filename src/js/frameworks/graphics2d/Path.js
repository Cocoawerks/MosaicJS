// A shape built up segment by segment — Java2D's GeneralPath, and the one
// piece of the IR that is a value rather than an operation.
//
//   const arrow = new Path()
//       .moveTo(0, 0)
//       .lineTo(20, 10)
//       .lineTo(0, 20)
//       .close();
//
//   g.setColor("#3584e4");
//   g.fill(arrow);
//
// A path is recorded once and can be drawn any number of times, at any
// transform. It holds numbers and nothing else, so it survives being written
// down alongside the operations that use it.

/** What a path is made of. The names are PathIterator's segment types. */
export const Seg = Object.freeze({
  MOVE: "moveTo",
  LINE: "lineTo",
  /** A quadratic Bézier — one control point. */
  QUAD: "quadTo",
  /** A cubic — two. */
  CUBIC: "curveTo",
  /** A circular arc tangent to two lines, rounded by a radius. */
  ARC_TO: "arcTo",
  /** A slice of an ellipse: `{x, y, width, height, start, extent}`. */
  ARC: "arc",
  CLOSE: "close",
});

export default class Path {
  constructor(segments = []) {
    /** The segments, in the order they were added. */
    this.segments = segments;
  }

  /** A copy, so a path handed out cannot be extended behind its owner's back. */
  clone() {
    return new Path(this.segments.map((s) => ({ ...s })));
  }

  /** Whether anything has been added yet. */
  get isEmpty() {
    return this.segments.length === 0;
  }

  /** Start a new subpath at a point. */
  moveTo(x, y) {
    this.segments.push({ seg: Seg.MOVE, x, y });
    return this;
  }

  lineTo(x, y) {
    this.segments.push({ seg: Seg.LINE, x, y });
    return this;
  }

  /** A quadratic Bézier through the control point (cx, cy). */
  quadTo(cx, cy, x, y) {
    this.segments.push({ seg: Seg.QUAD, cx, cy, x, y });
    return this;
  }

  /** A cubic Bézier, with a control point apiece for the two ends. */
  curveTo(c1x, c1y, c2x, c2y, x, y) {
    this.segments.push({ seg: Seg.CUBIC, c1x, c1y, c2x, c2y, x, y });
    return this;
  }

  /**
   * Round the corner between the line from where the path is to (x1, y1) and
   * the line from there to (x2, y2), with an arc of the given radius.
   */
  arcTo(x1, y1, x2, y2, radius) {
    this.segments.push({ seg: Seg.ARC_TO, x1, y1, x2, y2, radius });
    return this;
  }

  /**
   * A slice of the ellipse inscribed in the box (x, y, width, height), from
   * `start` degrees through `extent` degrees — Java2D's angles: zero at three
   * o'clock, positive anticlockwise.
   */
  arc(x, y, width, height, start, extent) {
    this.segments.push({ seg: Seg.ARC, x, y, width, height, start, extent });
    return this;
  }

  /** Close the current subpath back to where it started. */
  close() {
    this.segments.push({ seg: Seg.CLOSE });
    return this;
  }

  /** A rectangle, as its own subpath. */
  rect(x, y, width, height) {
    return this.moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .close();
  }

  /** A run of points, closed or not — what drawPolygon and drawPolyline use. */
  polyline(xs, ys, closed = false) {
    const count = Math.min(xs.length, ys.length);
    if (count === 0) return this;
    this.moveTo(xs[0], ys[0]);
    for (let i = 1; i < count; i++) this.lineTo(xs[i], ys[i]);
    return closed ? this.close() : this;
  }
}
