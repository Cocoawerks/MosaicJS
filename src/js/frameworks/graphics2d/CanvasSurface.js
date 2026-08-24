// CanvasSurface — the one module that knows what a <canvas> is.
//
// It takes the list of operations a {@link Graphics2d} recorded and replays it
// onto a CanvasRenderingContext2D, translating where the two disagree: Java2D's
// bounding boxes into centres and radii, its degrees anticlockwise from three
// o'clock into radians clockwise, its single paint into the canvas's two.
//
// Everything web-shaped about the framework is here. A Java2D surface is the
// same file written against `java.awt.Graphics2D`, and nothing else moves.
import { Op, WindingRule } from "./ops.js";
import { Seg } from "./Path.js";

/** Degrees as Java2D means them, into radians as a canvas does. */
function radians(degrees) {
  // Java measures anticlockwise from three o'clock with y up; a canvas
  // measures clockwise with y down. Negating the angle is the whole of it.
  return (-degrees * Math.PI) / 180;
}

export default class CanvasSurface {
  /**
   * @param {CanvasRenderingContext2D} ctx Where the drawing lands.
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * How wide a string is in a given font — what a Graphics2d's `stringWidth`
   * asks, answered by the device that will draw it.
   *
   * The context's font is set and put back, so a measurement taken in the
   * middle of a drawing cannot change what the drawing looks like.
   */
  measureText(text, font) {
    const { ctx } = this;
    const previous = ctx.font;
    ctx.font = font;
    const width = ctx.measureText(text).width;
    ctx.font = previous;
    return width;
  }

  /**
   * Replay a drawing.
   *
   * @param {Array<object>} ops The operations, in order.
   */
  flush(ops) {
    for (const op of ops) this.apply(op);
  }

  /** One operation. */
  apply(op) {
    const { ctx } = this;

    switch (op.op) {
      // ---- State --------------------------------------------------------
      case Op.SAVE:
        ctx.save();
        return;
      case Op.RESTORE:
        ctx.restore();
        return;
      case Op.SET_PAINT: {
        // One paint, two properties: a canvas asks separately what to outline
        // with and what to fill with, and Java2D does not.
        const paint = this.paintValue(op.paint);
        ctx.strokeStyle = paint;
        ctx.fillStyle = paint;
        return;
      }
      case Op.SET_STROKE:
        ctx.lineWidth = op.width;
        ctx.lineCap = op.cap;
        ctx.lineJoin = op.join;
        ctx.miterLimit = op.miterLimit;
        ctx.setLineDash(op.dash ?? []);
        ctx.lineDashOffset = op.dashPhase ?? 0;
        return;
      case Op.SET_FONT:
        ctx.font = op.font;
        return;
      case Op.SET_ALPHA:
        ctx.globalAlpha = op.alpha;
        return;
      case Op.SET_COMPOSITE:
        ctx.globalCompositeOperation = op.composite;
        return;
      case Op.SET_TEXT_ALIGN:
        ctx.textAlign = op.align;
        return;
      case Op.SET_TEXT_BASELINE:
        ctx.textBaseline = op.baseline;
        return;

      // ---- Transform ----------------------------------------------------
      case Op.TRANSLATE:
        ctx.translate(op.x, op.y);
        return;
      case Op.SCALE:
        ctx.scale(op.sx, op.sy);
        return;
      case Op.ROTATE:
        // Rotating about a point is a translate there, the rotation, and a
        // translate back — which is what AWT's two-argument rotate() is.
        if (op.x === null || op.x === undefined) {
          ctx.rotate(op.theta);
        } else {
          ctx.translate(op.x, op.y);
          ctx.rotate(op.theta);
          ctx.translate(-op.x, -op.y);
        }
        return;
      case Op.SHEAR:
        ctx.transform(1, op.shy, op.shx, 1, 0, 0);
        return;
      case Op.TRANSFORM:
        ctx.transform(...op.m);
        return;
      case Op.SET_TRANSFORM:
        ctx.setTransform(...op.m);
        return;

      // ---- Clip ---------------------------------------------------------
      case Op.CLIP_RECT:
        ctx.beginPath();
        ctx.rect(op.x, op.y, op.width, op.height);
        ctx.clip();
        return;
      case Op.CLIP_PATH:
        this.tracePath(op.path);
        ctx.clip(op.rule ?? WindingRule.NON_ZERO);
        return;

      // ---- Shapes -------------------------------------------------------
      case Op.DRAW_LINE:
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        return;
      case Op.DRAW_RECT:
        ctx.strokeRect(op.x, op.y, op.width, op.height);
        return;
      case Op.FILL_RECT:
        ctx.fillRect(op.x, op.y, op.width, op.height);
        return;
      case Op.CLEAR_RECT:
        ctx.clearRect(op.x, op.y, op.width, op.height);
        return;
      case Op.DRAW_ROUND_RECT:
        this.traceRoundRect(op);
        ctx.stroke();
        return;
      case Op.FILL_ROUND_RECT:
        this.traceRoundRect(op);
        ctx.fill();
        return;
      case Op.DRAW_OVAL:
        this.traceOval(op);
        ctx.stroke();
        return;
      case Op.FILL_OVAL:
        this.traceOval(op);
        ctx.fill();
        return;
      case Op.DRAW_ARC:
        this.traceArc(op, false);
        ctx.stroke();
        return;
      case Op.FILL_ARC:
        // Filled, an arc is the pie wedge back to the centre — Java2D's PIE.
        this.traceArc(op, true);
        ctx.fill();
        return;
      case Op.DRAW_POLYLINE:
        this.tracePoints(op.xs, op.ys, false);
        ctx.stroke();
        return;
      case Op.DRAW_POLYGON:
        this.tracePoints(op.xs, op.ys, true);
        ctx.stroke();
        return;
      case Op.FILL_POLYGON:
        this.tracePoints(op.xs, op.ys, true);
        ctx.fill();
        return;
      case Op.DRAW_PATH:
        this.tracePath(op.path);
        ctx.stroke();
        return;
      case Op.FILL_PATH:
        this.tracePath(op.path);
        ctx.fill(op.rule ?? WindingRule.NON_ZERO);
        return;

      // ---- Text ---------------------------------------------------------
      case Op.DRAW_STRING:
        ctx.fillText(op.text, op.x, op.y);
        return;

      // ---- Images -------------------------------------------------------
      case Op.DRAW_IMAGE:
        this.drawImage(op);
        return;

      default:
        // An operation this surface has never heard of. Ignored rather than
        // thrown over: a drawing recorded against a newer Graphics2d should
        // lose the part this cannot show, not the whole picture.
        return;
    }
  }

  /**
   * A paint as the canvas wants it: a colour passes through, a gradient is
   * built against the context.
   *
   * Built afresh each time it is set, because a CanvasGradient belongs to the
   * context that made it — which is exactly why the IR describes gradients
   * rather than holding them.
   */
  paintValue(paint) {
    if (typeof paint === "string" || paint == null) return paint;

    const { ctx } = this;
    const gradient =
      paint.type === "radial"
        ? ctx.createRadialGradient(
            paint.x0,
            paint.y0,
            paint.r0,
            paint.x1,
            paint.y1,
            paint.r1,
          )
        : ctx.createLinearGradient(paint.x0, paint.y0, paint.x1, paint.y1);

    for (const [offset, color] of paint.stops)
      gradient.addColorStop(offset, color);
    return gradient;
  }

  /** The oval inscribed in a box, as a centre and two radii. */
  traceOval({ x, y, width, height }) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
  }

  /**
   * A slice of it. `pie` closes the slice back through the centre, which is
   * what a filled arc means and a drawn one does not.
   */
  traceArc({ x, y, width, height, start, extent }, pie) {
    const { ctx } = this;
    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.beginPath();
    if (pie) ctx.moveTo(cx, cy);
    ctx.ellipse(
      cx,
      cy,
      width / 2,
      height / 2,
      0,
      radians(start),
      radians(start + extent),
      // Java's positive extent sweeps anticlockwise; the canvas calls that
      // direction anticlockwise too, once the angles themselves are negated.
      extent > 0,
    );
    if (pie) ctx.closePath();
  }

  /** A rectangle whose corners are cut from an ellipse. */
  traceRoundRect({ x, y, width, height, arcWidth, arcHeight }) {
    const { ctx } = this;
    // Java2D gives the arc's full width and height; a corner radius is half of
    // each, and neither may be more than half the side it rounds.
    const rx = Math.min(Math.abs(arcWidth) / 2, Math.abs(width) / 2);
    const ry = Math.min(Math.abs(arcHeight) / 2, Math.abs(height) / 2);

    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + width - rx, y);
    ctx.ellipse(x + width - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    ctx.lineTo(x + width, y + height - ry);
    ctx.ellipse(x + width - rx, y + height - ry, rx, ry, 0, 0, Math.PI / 2);
    ctx.lineTo(x + rx, y + height);
    ctx.ellipse(x + rx, y + height - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + ry);
    ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  /** A run of points, closed or not. */
  tracePoints(xs, ys, closed) {
    const { ctx } = this;
    const count = Math.min(xs.length, ys.length);
    ctx.beginPath();
    if (count === 0) return;
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < count; i++) ctx.lineTo(xs[i], ys[i]);
    if (closed) ctx.closePath();
  }

  /** A {@link Path}'s segments, laid down as a canvas path. */
  tracePath(segments) {
    const { ctx } = this;
    ctx.beginPath();

    for (const s of segments) {
      switch (s.seg) {
        case Seg.MOVE:
          ctx.moveTo(s.x, s.y);
          break;
        case Seg.LINE:
          ctx.lineTo(s.x, s.y);
          break;
        case Seg.QUAD:
          ctx.quadraticCurveTo(s.cx, s.cy, s.x, s.y);
          break;
        case Seg.CUBIC:
          ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y);
          break;
        case Seg.ARC_TO:
          ctx.arcTo(s.x1, s.y1, s.x2, s.y2, s.radius);
          break;
        case Seg.ARC:
          ctx.ellipse(
            s.x + s.width / 2,
            s.y + s.height / 2,
            s.width / 2,
            s.height / 2,
            0,
            radians(s.start),
            radians(s.start + s.extent),
            s.extent > 0,
          );
          break;
        case Seg.CLOSE:
          ctx.closePath();
          break;
        default:
          break;
      }
    }
  }

  /** One of the three shapes of drawImage, told apart by what it was given. */
  drawImage(op) {
    const { ctx } = this;
    if (op.sWidth !== undefined) {
      ctx.drawImage(
        op.image,
        op.sx,
        op.sy,
        op.sWidth,
        op.sHeight,
        op.dx,
        op.dy,
        op.dWidth,
        op.dHeight,
      );
      return;
    }
    if (op.dWidth === null || op.dWidth === undefined) {
      ctx.drawImage(op.image, op.dx, op.dy);
      return;
    }
    ctx.drawImage(op.image, op.dx, op.dy, op.dWidth, op.dHeight);
  }
}
