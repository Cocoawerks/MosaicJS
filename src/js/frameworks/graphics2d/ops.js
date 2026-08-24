// The intermediate representation: the names of the operations a drawing is
// made of, and nothing else.
//
// A Graphics2d records; a surface replays. Neither knows the other, and the
// list between them is the whole of the contract — a plain array of plain
// objects, `{op, …}`, holding numbers, strings and arrays. Nothing in it is a
// canvas context, a DOM node, or a closure, which is what lets the same list be
// replayed onto a <canvas> here and handed to a Java2D surface later, or
// written to a file, compared against another drawing, or replayed twice.
//
// The names are Java2D's, because that is where this is going. `DRAW_OVAL`
// takes a bounding box rather than a centre and radii; `DRAW_ARC` measures its
// angles in degrees anticlockwise from three o'clock. The web's spelling of all
// of that lives in CanvasSurface, which is the one module allowed to know it.

/**
 * Every operation a {@link Graphics2d} can record.
 *
 * Grouped as the class is: state, transform, clip, shapes, text, images.
 */
export const Op = Object.freeze({
  // ---- State ------------------------------------------------------------
  /** Push the whole graphics state — paint, stroke, font, transform, clip. */
  SAVE: "save",
  /** Pop it. */
  RESTORE: "restore",
  /** `{paint}` — what both drawing and filling use, as Java2D's Paint does. */
  SET_PAINT: "setPaint",
  /** `{width, cap, join, miterLimit, dash, dashPhase}` — a BasicStroke. */
  SET_STROKE: "setStroke",
  /** `{font}` — a CSS font shorthand; a Java surface parses it into a Font. */
  SET_FONT: "setFont",
  /** `{alpha}` — 0..1, an AlphaComposite. */
  SET_ALPHA: "setAlpha",
  /** `{composite}` — the blend rule, named as Canvas names it. */
  SET_COMPOSITE: "setComposite",
  /** `{align}`, `{baseline}` — where a string sits relative to its point. */
  SET_TEXT_ALIGN: "setTextAlign",
  SET_TEXT_BASELINE: "setTextBaseline",

  // ---- Transform --------------------------------------------------------
  /** `{x, y}` */
  TRANSLATE: "translate",
  /** `{sx, sy}` */
  SCALE: "scale",
  /** `{theta, x, y}` — radians; about the origin unless a point is given. */
  ROTATE: "rotate",
  /** `{shx, shy}` */
  SHEAR: "shear",
  /** `{m}` — [a, b, c, d, e, f], concatenated onto the current transform. */
  TRANSFORM: "transform",
  /** `{m}` — the same six, replacing it. */
  SET_TRANSFORM: "setTransform",

  // ---- Clip -------------------------------------------------------------
  /** `{x, y, width, height}` — intersected with the current clip. */
  CLIP_RECT: "clipRect",
  /** `{path, rule}` — likewise, against a path. */
  CLIP_PATH: "clipPath",

  // ---- Shapes -----------------------------------------------------------
  /** `{x1, y1, x2, y2}` */
  DRAW_LINE: "drawLine",
  /** `{x, y, width, height}` */
  DRAW_RECT: "drawRect",
  FILL_RECT: "fillRect",
  CLEAR_RECT: "clearRect",
  /** `{x, y, width, height, arcWidth, arcHeight}` */
  DRAW_ROUND_RECT: "drawRoundRect",
  FILL_ROUND_RECT: "fillRoundRect",
  /** `{x, y, width, height}` — the oval inscribed in that box. */
  DRAW_OVAL: "drawOval",
  FILL_OVAL: "fillOval",
  /** `{x, y, width, height, start, extent}` — degrees, anticlockwise. */
  DRAW_ARC: "drawArc",
  FILL_ARC: "fillArc",
  /** `{xs, ys}` — an open run of segments. */
  DRAW_POLYLINE: "drawPolyline",
  /** `{xs, ys}` — closed. */
  DRAW_POLYGON: "drawPolygon",
  FILL_POLYGON: "fillPolygon",
  /** `{path}` / `{path, rule}` — a shape built up by {@link Path}. */
  DRAW_PATH: "drawPath",
  FILL_PATH: "fillPath",

  // ---- Text -------------------------------------------------------------
  /** `{text, x, y}` — the baseline origin, as Java2D's drawString. */
  DRAW_STRING: "drawString",

  // ---- Images -----------------------------------------------------------
  /**
   * `{image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight}` — the source
   * rectangle may be absent, meaning the whole image.
   *
   * `image` is the one value in the IR that is not data: it is whatever the
   * surface understands as a picture, an HTMLImageElement here and a
   * BufferedImage in Java. A drawing that means to survive being written down
   * names its images rather than holding them; see {@link Graphics2d#drawImage}.
   */
  DRAW_IMAGE: "drawImage",
});

/** How a path decides what is inside it — Java2D's winding rules. */
export const WindingRule = Object.freeze({
  NON_ZERO: "nonzero",
  EVEN_ODD: "evenodd",
});

/** How a stroke ends — BasicStroke's CAP_ constants, spelled as Canvas does. */
export const Cap = Object.freeze({
  BUTT: "butt",
  ROUND: "round",
  SQUARE: "square",
});

/** And how it turns a corner — BasicStroke's JOIN_ constants. */
export const Join = Object.freeze({
  MITER: "miter",
  ROUND: "round",
  BEVEL: "bevel",
});
