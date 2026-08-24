# graphics2d

An intermediate representation of two-dimensional drawing, and the two ends
that meet over it.

A component paints onto a `Graphics2d`, which draws nothing: every method
appends an operation to a list, and the list is the drawing. Something else
replays it — `CanvasSurface` does, onto a `CanvasRenderingContext2D` — so the
painting code names no canvas, no context and no pixel ratio, and can be
replayed onto something that is not a browser.

```js
paint(g) {
  g.setColor("#1c71d8");
  g.fillRoundRect(8, 8, 120, 40, 8, 8);
  g.setColor("white");
  g.setFont("13px system-ui");
  g.drawString("Hello", 20, 33);
}
```

which is, as a value:

```json
[
  {"op": "setPaint", "paint": "#1c71d8"},
  {"op": "fillRoundRect", "x": 8, "y": 8, "width": 120, "height": 40,
   "arcWidth": 8, "arcHeight": 8},
  {"op": "setPaint", "paint": "white"},
  {"op": "setFont", "font": "13px system-ui"},
  {"op": "drawString", "text": "Hello", "x": 20, "y": 33}
]
```

## What the framework is made of

| Module             | What it is                                                    |
| ------------------ | ------------------------------------------------------------- |
| `ops.js`           | The operation names and the enums. The IR's vocabulary.       |
| `Graphics2d.js`    | The recorder: the drawing API, and the list it appends to.    |
| `Path.js`          | A shape as a segment list — the one IR value that is not an op. |
| `CanvasSurface.js` | The replayer. The only module that knows what a canvas is.    |
| `Canvas.js`        | The component: a `<canvas>` tag and a `paint(g)` to override. |

A Java2D surface is `CanvasSurface.js` written against `java.awt.Graphics2D`.
Nothing else moves.

## The shape of the IR

A drawing is a JavaScript array. An operation is a plain object whose `op` field
names it and whose other fields are its arguments, named rather than positional:

```
{op: "fillRect", x: 0, y: 0, width: 20, height: 10}
```

Three rules hold for every operation, and they are what the IR is for:

- **It is data.** Numbers, strings, booleans, arrays and plain objects. No
  context, no DOM node, no function, no class instance. A drawing survives
  `JSON.parse(JSON.stringify(…))` unchanged, which is the test the suite makes
  of it — what survives that can be written to a file, compared against another
  drawing, sent over a wire, or handed to a renderer in another language.
- **It is absolute.** An operation means the same thing wherever it sits in the
  list. State operations change what follows them, but no operation depends on
  being replayed by any particular surface.
- **It is ordered and replayable.** Replaying the same list twice draws the same
  picture twice. A `Graphics2d` is filled once and then treated as finished;
  `reset()` starts a new drawing rather than editing the old one.

The one thing a drawing cannot say is a question. See
[Measuring](#measuring-the-one-leak) below.

## Conventions

The API and the IR are **Java2D's**, not the canvas's, because Java2D is where
this is going. Where the two disagree, the IR speaks Java and the surface
translates. Four places matter:

**One paint, not two.** `setColor` sets what both outlining and filling use, as
`java.awt.Graphics2D` does; a canvas surface assigns it to `strokeStyle` and
`fillStyle` both. A drawing wanting an outline in one colour and a fill in
another sets the colour twice.

`setColor` and `setPaint` are the same method under two names, as Java2D has
them: `setColor` takes a colour and is what nearly every drawing reaches for,
`setPaint` is the general one that also takes a gradient. Both record the one
operation, and it is named `setPaint` — the field can hold either, and an
operation named for a colour should not be found carrying a gradient.

**Ovals and arcs take the box they are inscribed in**, not a centre and radii:
`drawOval(x, y, width, height)`. The surface halves it.

**Arc angles are degrees, anticlockwise, from three o'clock** — `drawArc(x, y,
w, h, start, extent)`. A canvas measures radians clockwise, so the surface
negates the angle; negating is the whole of the translation, and it is why a
positive `extent` still reads as anticlockwise on screen. A filled arc is the
pie wedge closed back through the centre; a drawn one is the bare curve.

**A round rect's `arcWidth`/`arcHeight` are diameters** — the full width and
height of the ellipse the corners are cut from, so twice the corner radius. The
surface halves them and clamps each to half the side it rounds.

Beyond those: y runs downwards, `drawString` puts the text's *baseline* at the
point it is given, and the unit is a CSS pixel whatever the display's density
(`Canvas` sets a transform for the device ratio before every flush, so painting
code never sees it).

## The operations

Named by the `Op` constants in `ops.js`; the string is the value.

### State

| Op                 | Fields                                                  | Notes                                                              |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `save`             | —                                                       | Pushes paint, stroke, font, alpha, composite, transform and clip.  |
| `restore`          | —                                                       | Pops them. The only way back from a clip or a transform.           |
| `setPaint`         | `paint`                                                 | A CSS colour string, or a gradient (below). Recorded by `setColor` too. |
| `setStroke`        | `width, cap, join, miterLimit, dash, dashPhase`         | A `BasicStroke`. `dash` is `null` or an array of lengths.          |
| `setFont`          | `font`                                                  | A CSS font shorthand; a Java surface parses it into a `Font`.      |
| `setAlpha`         | `alpha`                                                 | 0 to 1 — an `AlphaComposite`.                                      |
| `setComposite`     | `composite`                                             | The blend rule, named as Canvas names it.                          |
| `setTextAlign`     | `align`                                                 | `left`/`center`/`right`. Java2D has no such thing; see below.      |
| `setTextBaseline`  | `baseline`                                              | `alphabetic`/`top`/`middle`/`bottom`.                              |

### Transform

| Op             | Fields          | Notes                                                        |
| -------------- | --------------- | ------------------------------------------------------------ |
| `translate`    | `x, y`          |                                                              |
| `scale`        | `sx, sy`        |                                                              |
| `rotate`       | `theta, x, y`   | Radians. `x`/`y` are `null` to rotate about the origin.       |
| `shear`        | `shx, shy`      |                                                              |
| `transform`    | `m`             | `[a, b, c, d, e, f]`, concatenated onto the current one.      |
| `setTransform` | `m`             | The same six, replacing it.                                   |

### Clip

| Op         | Fields                    | Notes                                                |
| ---------- | ------------------------- | ---------------------------------------------------- |
| `clipRect` | `x, y, width, height`     | Intersected with the current clip, as Java2D's is.   |
| `clipPath` | `path, rule`              | Likewise, against a path. `rule` is a winding rule.  |

A clip only ever narrows. Widening it again means `restore()`.

### Shapes

| Op                                | Fields                                              |
| --------------------------------- | --------------------------------------------------- |
| `drawLine`                        | `x1, y1, x2, y2`                                    |
| `drawRect` / `fillRect`           | `x, y, width, height`                               |
| `clearRect`                       | `x, y, width, height`                               |
| `drawRoundRect` / `fillRoundRect` | `x, y, width, height, arcWidth, arcHeight`          |
| `drawOval` / `fillOval`           | `x, y, width, height`                               |
| `drawArc` / `fillArc`             | `x, y, width, height, start, extent`                |
| `drawPolyline`                    | `xs, ys`                                            |
| `drawPolygon` / `fillPolygon`     | `xs, ys` — closed                                   |
| `drawPath` / `fillPath`           | `path`, and `rule` for the fill                     |

`clearRect` erases to nothing here and to the background colour in AWT, which is
the one operation whose meaning is not quite the same on both sides.

### Text and images

| Op           | Fields                                                          |
| ------------ | --------------------------------------------------------------- |
| `drawString` | `text, x, y` — the baseline origin                              |
| `drawImage`  | `image, dx, dy, dWidth, dHeight` and optionally `sx, sy, sWidth, sHeight` |

## Paths

`Path` is a shape built segment by segment — Java2D's `GeneralPath`, and the one
value in the IR that is not an operation. It holds numbers and nothing else, so
it travels with the drawing that uses it, and a path recorded once can be drawn
any number of times at any transform.

```js
const arrow = new Path().moveTo(0, 0).lineTo(20, 10).lineTo(0, 20).close();
g.fill(arrow);
```

An operation carrying a path carries its `segments` array, not the object. A
segment is `{seg, …}`, named by the `Seg` constants — `moveTo`, `lineTo`,
`quadTo`, `curveTo`, `arcTo`, `arc`, `close` — which are `PathIterator`'s
segment types. `arc` takes the same bounding box and Java-convention degrees as
`drawArc`.

`rect()` and `polyline()` are shorthands that add the segments a rectangle or a
run of points is made of; there is no rectangle segment.

## Paints

A paint is a CSS colour string, or a gradient — which is *described*, never
held:

```js
g.setPaint(linearGradient(0, 0, 0, 64, "#1c71d8", "#0b3d91"));
```

```json
{"type": "linear", "x0": 0, "y0": 0, "x1": 0, "y1": 64,
 "stops": [[0, "#1c71d8"], [1, "#0b3d91"]]}
```

Described rather than held because a `CanvasGradient` belongs to the context
that made it, and the IR belongs to no context: the surface builds one each time
the paint is set. `radialGradient(x0, y0, r0, x1, y1, r1, …)` is the same with
two circles. Stops are `[[offset, colour], …]`; two colours given bare are
spread evenly from one end to the other.

## Images: the one value that is not data

`drawImage`'s `image` field is whatever the surface understands as a picture —
an `HTMLImageElement` on a canvas, a `BufferedImage` in Java. It is the single
exception to "the IR is data", and a drawing that means to be written down and
replayed elsewhere should pass a **name** and leave the surface to resolve it.

## Measuring: the one leak

A drawing states things; it cannot ask them. The exception is text, whose width
depends on a font as some particular device has it and so cannot come out of a
list of operations. `Graphics2d.stringWidth(text)` answers by calling a
`measureText` given to it at construction — `Canvas` passes its surface's, so
the answer is the right one for the device the drawing is going to. With no
measurer it estimates from the font size, which is enough to lay something out
roughly and not enough to centre it.

Prefer `setTextAlign`/`setTextBaseline` where they will do. Those the surface
honours exactly, and they cost the IR nothing — a Java surface does the
measuring on its own side, which is where it belongs.

## Unknown operations

A surface ignores an operation it has never heard of rather than throwing over
it: a drawing recorded against a newer `Graphics2d` should lose the part that
cannot be shown, not the whole picture. Adding an operation therefore means
adding it to `ops.js`, to `Graphics2d`, and to every surface — and a surface
that has not caught up degrades instead of failing.

## Painting with it

`Canvas` is the component end: a `<canvas>` tag with one method to override.

```js
import { Canvas, Cap } from "mosaic/frameworks/graphics2d";

export default class Dial extends Canvas {
  static props = { value: { type: Number, default: 0 } };

  paint(g) {
    g.setStroke({ width: 8, cap: Cap.ROUND });
    g.setColor("#1c71d8");
    g.drawArc(8, 8, this.width - 16, this.height - 16, 225, -270 * this.value);
  }
}
```

```xml
<Dial width="140" height="140" value="0.6"/>
```

- **`paint(g)`, not `draw()`.** `draw()` is how every Mosaic component states
  its markup, and a Canvas's markup is the one tag; `paint` is Swing's name for
  this anyway.
- **Assigning a declared setting repaints.** `dial.value = 0.8` schedules a
  painting for the next frame, the way assigning a property redraws a marked-up
  component, and several assignments in a turn cost one painting. State kept
  where a setting cannot see it — a plain field, an array mutated in place —
  needs `repaint()`, which is what `needsDisplay()` means here.
- **`paintNow()`** paints this instant rather than next frame, for the caller
  who has to have the picture now: an export, a test, or code about to read
  `canvas.ops`.
- **Size.** A Canvas given no `width`/`height` fills what holds it and repaints
  when that changes. `this.width`/`this.height` inside `paint` are the room it
  actually has, in CSS pixels.
- **`this.ops`** is the last drawing, kept after it was flushed — the point of
  recording rather than drawing. `examples/Graphics` prints it under the dial.

## Where this is going

Java2D. The IR already speaks its dialect, so the port is one file:
`CanvasSurface` replaced by a surface holding a `java.awt.Graphics2D`, reading
the same list. `drawOval` becomes `drawOval`, the arc angles arrive in the
convention `drawArc` already wants, `setColor` becomes `setColor`, and the
translations this side had to make — halving boxes, negating angles, splitting
one paint into two — are the ones that side does not.
