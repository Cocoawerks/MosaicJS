// A dial, drawn rather than marked up: a Canvas subclass whose whole job is
// `paint(g)`.
//
// Nothing here names a canvas, a context, or a pixel ratio. It states the
// drawing to a Graphics2d in Java2D's terms — a bounding box, degrees
// anticlockwise from three o'clock — and the framework replays it.
import { Canvas, Cap } from "mosaic/frameworks/graphics2d";

/** Where the track starts, and how far round it goes. Java2D's angles. */
const START = 225;
const SWEEP = -270;

export default class Dial extends Canvas {
  static properties = {
    /** How far round, 0 to 1. */
    value: { type: Number, default: 0 },
    /** What the filled part is drawn in. */
    color: { type: String, default: "#1c71d8" },
    /** What is written in the middle. */
    label: { type: String, default: "" },
  };

  paint(g) {
    const { width, height } = this;
    const inset = 10;
    const box = [inset, inset, width - inset * 2, height - inset * 2];
    const value = Math.max(0, Math.min(1, this.value));

    g.setStroke({ width: 10, cap: Cap.ROUND });

    // The track.
    g.setColor("#e0e0e0");
    g.drawArc(...box, START, SWEEP);

    // And how much of it is filled.
    if (value > 0) {
      g.setColor(this.color);
      g.drawArc(...box, START, SWEEP * value);
    }

    // The reading, centred on the dial. `setTextAlign` is honoured by the
    // surface, so this needs no measuring.
    g.setColor("#303030");
    g.setFont(`600 ${Math.round(height / 6)}px system-ui, sans-serif`);
    g.setTextAlign("center");
    g.setTextBaseline("middle");
    g.drawString(
      this.label || `${Math.round(value * 100)}%`,
      width / 2,
      height / 2,
    );
  }
}
