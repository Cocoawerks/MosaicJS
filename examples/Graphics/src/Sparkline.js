// A sparkline: the same arrangement as Dial, but over data that changes and a
// canvas that takes whatever width it is given.
//
// It shows the two things a drawn component has to get right — repainting when
// its data changes, and reading its own size rather than assuming one. Neither
// costs it a line: assigning `values` repaints, and `this.width` is however
// much room the layout ended up giving the tag.
import { Canvas, Cap, Join, Path, linearGradient } from "mosaic/frameworks/graphics2d";

export default class Sparkline extends Canvas {
  static props = {
    /** The numbers being plotted. Assigning them repaints. */
    values: { type: Array, default: [] },
    /** The line's colour. */
    color: { type: String, default: "#2ec27e" },
  };

  paint(g) {
    const { width, height } = this;
    const values = this.values;
    if (values.length < 2) return;

    const inset = 6;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 1;

    const xs = values.map(
      (_, i) => inset + (i * (width - inset * 2)) / (values.length - 1),
    );
    const ys = values.map(
      (v) => height - inset - ((v - low) / span) * (height - inset * 2),
    );

    // The area under the line, as a path closed along the bottom.
    const area = new Path().polyline(xs, ys);
    area.lineTo(xs[xs.length - 1], height).lineTo(xs[0], height).close();

    g.setPaint(
      linearGradient(0, 0, 0, height, [
        [0, "rgba(46, 194, 126, 0.35)"],
        [1, "rgba(46, 194, 126, 0)"],
      ]),
    );
    g.fill(area);

    // And the line itself.
    g.setPaint(this.color);
    g.setStroke({ width: 2, cap: Cap.ROUND, join: Join.ROUND });
    g.drawPolyline(xs, ys);

    // The latest reading, marked.
    const last = xs.length - 1;
    g.fillOval(xs[last] - 3, ys[last] - 3, 6, 6);
  }
}
