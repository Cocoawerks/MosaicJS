// graphics2d — the drawing IR, the canvas surface that replays it, and the
// Canvas component that puts the two together.
// Build first: `mosaic compile examples/Graphics --keep-modules` — these tests
// import the compiled modules themselves, which a plain compile prunes once
// they are in the bundle.
//
// What is checked here is the translation: an operations list is a value, so a
// drawing can be asserted about without anything having been drawn, and the
// surface can be replayed against a context that only remembers what it was
// asked to do.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount } = await import(
  "../examples/Graphics/build/node_modules/mosaic/runtime/mosaic.js"
);
const { Canvas, CanvasSurface, Graphics2d, Path, Op, Cap, linearGradient } =
  await import(
    "../examples/Graphics/build/node_modules/mosaic/frameworks/graphics2d/index.js"
  );

/**
 * A 2D context that draws nothing and remembers everything: every call as
 * `["name", …args]`, every property as an assignment of its own.
 */
function recordingContext() {
  const calls = [];
  const target = {
    calls,
    measureText: (text) => ({ width: text.length * 7 }),
    createLinearGradient(...args) {
      calls.push(["createLinearGradient", ...args]);
      return { stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
    },
    createRadialGradient(...args) {
      calls.push(["createRadialGradient", ...args]);
      return { stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
    },
  };

  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(object, key, value) {
      calls.push(["=" + key, value]);
      object[key] = value;
      return true;
    },
  });
}

/** The names of the calls made, in order — enough for most assertions. */
const names = (ctx) => ctx.calls.map((call) => call[0]);

/** The first call of a given name, whole. */
const firstCall = (ctx, name) => ctx.calls.find((call) => call[0] === name);

// ---------------------------------------------------------------- the IR ---

test("drawing methods record operations rather than drawing", () => {
  const g = new Graphics2d();

  g.setPaint("#1c71d8");
  g.fillRect(1, 2, 3, 4);
  g.drawString("hi", 5, 6);

  assert.deepEqual(g.ops, [
    { op: Op.SET_PAINT, paint: "#1c71d8" },
    { op: Op.FILL_RECT, x: 1, y: 2, width: 3, height: 4 },
    { op: Op.DRAW_STRING, text: "hi", x: 5, y: 6 },
  ]);
});

test("the operations are plain data — no context, no closures", () => {
  const g = new Graphics2d();
  g.setStroke({ width: 2, cap: Cap.ROUND, dash: [4, 4] });
  g.fill(new Path().rect(0, 0, 10, 10));

  // Round-tripping through JSON is the whole claim: what survives that can be
  // handed to a Java2D surface, written to a file, or compared.
  assert.deepEqual(JSON.parse(JSON.stringify(g.ops)), g.ops);
});

test("setStroke takes a width on its own, and fills in the rest", () => {
  const g = new Graphics2d();
  g.setStroke(3);

  assert.deepEqual(g.ops[0], {
    op: Op.SET_STROKE,
    width: 3,
    cap: Cap.BUTT,
    join: "miter",
    miterLimit: 10,
    dash: null,
    dashPhase: 0,
  });
});

test("save and restore put the recorded state back", () => {
  const g = new Graphics2d();
  g.setPaint("red");
  g.save();
  g.setPaint("blue");
  assert.equal(g.getPaint(), "blue");
  g.restore();
  assert.equal(g.getPaint(), "red");
});

test("drawImage tells its three shapes apart", () => {
  const g = new Graphics2d();
  g.drawImage("a", 1, 2);
  g.drawImage("a", 1, 2, 3, 4);
  g.drawImage("a", 1, 2, 3, 4, 5, 6, 7, 8);

  assert.equal(g.ops[0].dWidth, null);
  assert.equal(g.ops[1].dWidth, 3);
  assert.equal(g.ops[2].sWidth, 3);
  assert.equal(g.ops[2].dWidth, 7);
});

test("stringWidth asks the surface, when there is one to ask", () => {
  const ctx = recordingContext();
  const surface = new CanvasSurface(ctx);
  const g = new Graphics2d({
    measureText: (text, font) => surface.measureText(text, font),
  });

  assert.equal(g.stringWidth("abcd"), 28);
  // Measuring must not leave the font it measured in behind.
  assert.deepEqual(names(ctx).filter((n) => n === "=font"), ["=font", "=font"]);
});

// ----------------------------------------------------------- the surface ---

test("one paint sets both of the canvas's two", () => {
  const ctx = recordingContext();
  new CanvasSurface(ctx).flush([{ op: Op.SET_PAINT, paint: "#abc" }]);

  assert.deepEqual(ctx.calls, [
    ["=strokeStyle", "#abc"],
    ["=fillStyle", "#abc"],
  ]);
});

test("an oval's bounding box becomes a centre and two radii", () => {
  const ctx = recordingContext();
  new CanvasSurface(ctx).flush([
    { op: Op.FILL_OVAL, x: 10, y: 20, width: 40, height: 60 },
  ]);

  assert.deepEqual(firstCall(ctx, "ellipse"), [
    "ellipse", 30, 50, 20, 30, 0, 0, Math.PI * 2,
  ]);
  assert.deepEqual(names(ctx), ["beginPath", "ellipse", "fill"]);
});

test("Java2D's angles are turned round for the canvas", () => {
  const ctx = recordingContext();
  // 0 through 90 degrees: anticlockwise in Java, and the top-right quadrant on
  // a screen whose y runs downwards.
  new CanvasSurface(ctx).flush([
    { op: Op.DRAW_ARC, x: 0, y: 0, width: 100, height: 100, start: 0, extent: 90 },
  ]);

  const [, , , , , , from, to, anticlockwise] = firstCall(ctx, "ellipse");
  assert.equal(Math.abs(from), 0);
  assert.equal(to, -Math.PI / 2);
  assert.equal(anticlockwise, true);
});

test("a filled arc is a pie wedge, a drawn one is not", () => {
  const drawn = recordingContext();
  const filled = recordingContext();
  const arc = { x: 0, y: 0, width: 10, height: 10, start: 0, extent: 90 };

  new CanvasSurface(drawn).flush([{ op: Op.DRAW_ARC, ...arc }]);
  new CanvasSurface(filled).flush([{ op: Op.FILL_ARC, ...arc }]);

  assert.deepEqual(names(drawn), ["beginPath", "ellipse", "stroke"]);
  assert.deepEqual(names(filled), [
    "beginPath", "moveTo", "ellipse", "closePath", "fill",
  ]);
  assert.deepEqual(firstCall(filled, "moveTo"), ["moveTo", 5, 5]);
});

test("a round rect's arc width is a diameter, and is clamped to the side", () => {
  const ctx = recordingContext();
  new CanvasSurface(ctx).flush([
    {
      op: Op.FILL_ROUND_RECT,
      x: 0, y: 0, width: 20, height: 20,
      // Larger than the box: a corner may not round more than half a side.
      arcWidth: 100, arcHeight: 100,
    },
  ]);

  const corner = firstCall(ctx, "ellipse");
  assert.equal(corner[3], 10, "radius is half the side, not half the arc");
  assert.equal(corner[4], 10);
});

test("rotating about a point brackets the rotation with translates", () => {
  const ctx = recordingContext();
  new CanvasSurface(ctx).flush([
    { op: Op.ROTATE, theta: 1, x: 5, y: 6 },
    { op: Op.ROTATE, theta: 1, x: null, y: null },
  ]);

  assert.deepEqual(ctx.calls, [
    ["translate", 5, 6],
    ["rotate", 1],
    ["translate", -5, -6],
    ["rotate", 1],
  ]);
});

test("a gradient is described in the IR and built against the context", () => {
  const ctx = recordingContext();
  const g = new Graphics2d();
  g.setPaint(linearGradient(0, 0, 0, 64, "#fff", "#000"));

  // Described: two colours with no offsets are spread from end to end.
  assert.deepEqual(g.ops[0].paint.stops, [
    [0, "#fff"],
    [1, "#000"],
  ]);

  new CanvasSurface(ctx).flush(g.ops);
  assert.deepEqual(firstCall(ctx, "createLinearGradient"), [
    "createLinearGradient", 0, 0, 0, 64,
  ]);
  const [, style] = ctx.calls.find((call) => call[0] === "=fillStyle");
  assert.deepEqual(style.stops, [
    [0, "#fff"],
    [1, "#000"],
  ]);
});

test("a path replays segment for segment", () => {
  const ctx = recordingContext();
  const path = new Path()
    .moveTo(0, 0)
    .lineTo(10, 0)
    .quadTo(15, 5, 10, 10)
    .curveTo(8, 12, 4, 12, 0, 10)
    .close();

  new CanvasSurface(ctx).flush([{ op: Op.DRAW_PATH, path: path.segments }]);

  assert.deepEqual(names(ctx), [
    "beginPath",
    "moveTo",
    "lineTo",
    "quadraticCurveTo",
    "bezierCurveTo",
    "closePath",
    "stroke",
  ]);
});

test("an operation the surface has never heard of loses only itself", () => {
  const ctx = recordingContext();
  new CanvasSurface(ctx).flush([
    { op: "drawHologram" },
    { op: Op.FILL_RECT, x: 0, y: 0, width: 1, height: 1 },
  ]);

  assert.deepEqual(names(ctx), ["fillRect"]);
});

// --------------------------------------------------------- the component ---

/**
 * The shim has no canvas and no frames. Both are given here rather than to the
 * shim itself: a context that records is what these tests want to look at, and
 * a repaint that happens when it is asked for is what they want to time.
 */
function stubEnvironment() {
  const ctx = recordingContext();
  const element = document.createElement("canvas");
  Object.getPrototypeOf(element).getContext = () => ctx;

  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  window.devicePixelRatio = 2;

  return { ctx, run: () => frames.splice(0).forEach((fn) => fn()) };
}

/** A canvas that paints one rectangle and counts how often it was asked to. */
class Swatch extends Canvas {
  static properties = { color: { type: String, default: "red" } };

  constructor(controller) {
    super(controller);
    this.paintings = 0;
  }

  paint(g) {
    this.paintings += 1;
    g.setPaint(this.color);
    g.fillRect(0, 0, this.width, this.height);
  }
}

function mountSwatch(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return mount(Swatch, host, { width: 20, height: 10, ...props }).view;
}

test("a Canvas paints through the IR onto its context", () => {
  const { ctx, run } = stubEnvironment();
  const swatch = mountSwatch();
  run();

  assert.equal(swatch.paintings, 1);
  assert.deepEqual(swatch.ops, [
    { op: Op.SET_PAINT, paint: "red" },
    { op: Op.FILL_RECT, x: 0, y: 0, width: 20, height: 10 },
  ]);
  assert.deepEqual(firstCall(ctx, "fillRect"), ["fillRect", 0, 0, 20, 10]);
});

test("the drawing is in CSS pixels however dense the display is", () => {
  const { ctx, run } = stubEnvironment();
  mountSwatch();
  run();

  // The backing store is twice the size; the transform is what hides that from
  // the painting code, and it is set rather than concatenated.
  assert.deepEqual(ctx.calls[0], ["setTransform", 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(firstCall(ctx, "clearRect"), ["clearRect", 0, 0, 20, 10]);
});

test("assigning a setting repaints, and several assignments cost one painting", () => {
  const { run } = stubEnvironment();
  const swatch = mountSwatch();
  run();
  assert.equal(swatch.paintings, 1);

  swatch.color = "blue";
  swatch.color = "green";
  run();

  assert.equal(swatch.paintings, 2, "one frame, one painting");
  assert.equal(swatch.ops[0].paint, "green");
});

test("autoClear off leaves the last frame where it was", () => {
  const { ctx, run } = stubEnvironment();
  mountSwatch({ autoClear: false });
  run();

  assert.ok(!names(ctx).includes("clearRect"));
});

test("a Canvas that implements no paint says so", () => {
  stubEnvironment();
  class Blank extends Canvas {}
  const host = document.createElement("div");
  document.body.appendChild(host);

  assert.throws(
    () => mount(Blank, host, { width: 4, height: 4 }).view.paintNow(),
    /implements no paint/,
  );
});
