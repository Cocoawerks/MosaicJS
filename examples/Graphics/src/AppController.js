// The page's controller. It says nothing about drawing: it moves a number and
// hands a list of them over, and the two drawn components repaint themselves.

/**
 * One operation, written out.
 *
 * Nothing here knows what any of the operations are: an op is `{op, …}` and
 * the rest is printed as it comes. That is the point being made underneath the
 * dial — a drawing is plain data, so it can be listed without a canvas, a
 * renderer, or a case for every shape.
 */
function formatOp(op, index) {
  const { op: name, ...rest } = op;
  const args = Object.entries(rest)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  return `${String(index + 1).padStart(2)}  ${name.padEnd(15)} ${args}`;
}

/** A value inside one, kept to a line: numbers rounded, shapes summarised. */
function formatValue(value) {
  if (Array.isArray(value)) {
    const items = value.slice(0, 4).map(formatValue).join(", ");
    return `[${items}${value.length > 4 ? `, …${value.length}` : ""}]`;
  }
  if (value && typeof value === "object") {
    // A gradient, which is the one paint that is not a colour.
    return value.stops ? `${value.type ?? "gradient"}(${value.stops.length})` : "{…}";
  }
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return String(value);
}

export default class AppController {
  constructor() {
    /** What the dial reads, 0 to 1. */
    this.level = 0.42;

    /** What the sparkline plots — the readings so far. */
    this.history = [0.42];

    /**
     * What the page prints under the drawings.
     *
     * Plain state rather than a getter, because a `{binding}` is re-read when
     * something the controller holds is assigned — and a controller whose only
     * binding is a derived getter has nothing that is ever assigned, so the
     * getter would be read once and never again.
     */
    this.opsHint = "";

    /** And the operations themselves, written out under it. */
    this.opsList = "";
  }

  /** The outlets `main.ib.xml` fills in: the two drawn components. */
  attached() {
    this.push();
  }

  more() {
    this.level = Math.min(1, this.level + 0.1);
    this.push();
  }

  less() {
    this.level = Math.max(0, this.level - 0.1);
    this.push();
  }

  /**
   * Tell the two components what to draw.
   *
   * Assigning a declared setting repaints, so this is the whole of it — no
   * canvas is touched and nothing is told to redraw. `history` is replaced
   * rather than pushed to, because it is the assignment that is heard.
   */
  push() {
    this.history = [...this.history, this.level].slice(-40);
    this.dial.value = this.level;
    this.spark.values = this.history;

    // A repaint is asked for, not done: `dial.value = …` schedules one for the
    // next frame. The count below is about a drawing, so the drawing has to
    // have happened — `paintNow` is the way to say "now" rather than "soon",
    // and it is what an export or a test uses for the same reason.
    this.dial.paintNow();
    const ops = this.dial.ops;
    this.opsHint = `The dial's last painting was ${ops.length} operations — a Graphics2d keeps them.`;
    this.opsList = ops.map(formatOp).join("\n");
  }
}
