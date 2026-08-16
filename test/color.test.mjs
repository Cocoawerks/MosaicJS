// Color, ColorChooserPanel and ColorWell, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no canvas here, so what the two pickers paint is not what these
// check — that is checked in a browser. What they check is the arithmetic, and
// what the panel and the well do with a colour once they have one.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { Color, ColorChooserPanel, ColorWell } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

// --- Color -------------------------------------------------------------------

test("a colour is four numbers, and says itself as CSS", () => {
  const blue = new Color(53, 132, 228);

  assert.equal(blue.red, 53);
  assert.equal(blue.alpha, 100, "opaque unless told otherwise");
  assert.equal(blue.toString(), "rgba(53, 132, 228, 1)");
  assert.equal(blue.toHexString(), "#3584E4");
  assert.equal(blue.withAlpha(50).toString(), "rgba(53, 132, 228, 0.5)");
  assert.equal(blue.withAlpha(50).toHexString(true), "#3584E480");
});

test("and is read from hex in any of the three lengths", () => {
  assert.ok(Color.fromHex("#3584E4").equals(new Color(53, 132, 228)));
  assert.ok(
    Color.fromHex("3584e4").equals(new Color(53, 132, 228)),
    "the hash is optional",
  );
  assert.ok(
    Color.fromHex("#0af").equals(new Color(0, 170, 255)),
    "short form doubles each digit",
  );
  assert.equal(
    Color.fromHex("#3584E480").alpha,
    50,
    "eight digits carry the opacity",
  );
  assert.equal(
    Color.fromHex("#3584e4", 40).alpha,
    40,
    "six take the one they are given",
  );
});

test("what is not a colour is not guessed at", () => {
  for (const text of ["", "#", "#12", "#12345", "nonsense", "#3584E4X"]) {
    assert.equal(Color.fromHex(text), null, text);
  }
});

test("hue, saturation and brightness go round and come back", () => {
  for (const [r, g, b] of [
    [53, 132, 228],
    [255, 0, 0],
    [0, 255, 0],
    [18, 52, 86],
    [200, 200, 200],
  ]) {
    const colour = new Color(r, g, b);
    const { hue, saturation, brightness } = colour.toHSB();
    assert.ok(
      Color.fromHSB(hue, saturation, brightness).equals(colour),
      `${r},${g},${b}`,
    );
  }
});

test("a grey reports no hue, which is why the chooser keeps its own", () => {
  const grey = new Color(128, 128, 128).toHSB();

  assert.equal(grey.saturation, 0);
  assert.equal(grey.hue, 0, "every grey answers red, and means nothing by it");
});

// --- the chooser -------------------------------------------------------------

/** Mount a chooser, and hand back what a test needs to work it. */
function chooser(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(ColorChooserPanel, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const swatches = (el) =>
  el.querySelectorAll("div").filter((d) => classesOf(d).includes("ccp-swatch"));

test("the chooser draws the palette, the pickers and the controls", () => {
  const { el } = chooser();

  assert.deepEqual(classesOf(el), ["ccp-root"]);
  assert.equal(
    swatches(el).length,
    45,
    "nine families across, five shades down",
  );
  assert.equal(
    el.querySelectorAll("canvas").length,
    2,
    "the square and the strip",
  );
  assert.equal(el.querySelectorAll("input").length, 1, "the hex field");
});

test("it starts on the colour it was given, in every place it shows one", () => {
  const { el, view } = chooser({ color: "#3584E4" });

  assert.ok(view.color.equals(new Color(53, 132, 228)));
  assert.equal(el.querySelectorAll("input")[0].value, "3584E4");
  assert.equal(el.textContent.includes("100%"), true);
});

test("choosing a colour reports it", () => {
  const said = [];
  const { view } = chooser({
    color: "#000000",
    action: (panel, colour) => said.push(colour),
  });

  view.setColor(new Color(255, 0, 0));
  assert.equal(said.length, 1);
  assert.ok(said[0].equals(new Color(255, 0, 0)));

  // Assigning says nothing: the same split as everywhere else.
  view.color = new Color(0, 255, 0);
  assert.equal(said.length, 1);
});

test("a palette swatch is a commit, not just a colour", () => {
  const said = [];
  const picked = [];
  const { view } = chooser({
    action: (panel, colour) => said.push(colour),
    onPicked: () => picked.push(true),
  });

  view.pickSwatch(0x3584e4);
  assert.ok(view.color.equals(new Color(53, 132, 228)));
  assert.equal(said.length, 1, "it is a colour");
  assert.equal(picked.length, 1, "and the user is done");
});

test("the opacity slider moves the alpha and nothing else", () => {
  const { view } = chooser({ color: "#3584E4" });

  view.alphaChanged(null, 40);
  assert.equal(view.color.alpha, 40);
  assert.equal(view.color.red, 53, "the colour itself is untouched");
});

test("the hex field takes a colour, and ignores what is not one", () => {
  const { view } = chooser({ color: "#000000" });

  view.hexChanged(null, "3584E4");
  assert.ok(view.color.equals(new Color(53, 132, 228)));

  view.hexChanged(null, "35");
  assert.ok(
    view.color.equals(new Color(53, 132, 228)),
    "half-typed text changes nothing",
  );
});

test("and Enter in it is a commit", () => {
  const picked = [];
  const { view } = chooser({ onPicked: () => picked.push(true) });

  view.hexEntered(null, "#FF0000");
  assert.ok(view.color.equals(new Color(255, 0, 0)));
  assert.equal(picked.length, 1);
});

test("a grey does not throw the hue away", () => {
  const { view } = chooser({ color: "#FF0000" });
  const red = view.hue;

  view.setColor(new Color(128, 128, 128));
  assert.equal(
    view.hue,
    red,
    "the hue being worked survives a colour that has none",
  );
});

// --- the well ----------------------------------------------------------------

/** Mount a well over something to hang a chooser from. */
function well(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(ColorWell, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

test("the well is a button whose face is the colour", () => {
  const { el, view } = well({ color: "#3584E4" });

  assert.equal(el.tagName, "button");
  assert.ok(classesOf(el).includes("cw-well"));
  assert.ok(view.color.equals(new Color(53, 132, 228)));

  const swatch = el.querySelectorAll("i")[0];
  assert.ok(classesOf(swatch).includes("cw-swatch"));
  assert.equal(swatch.style.backgroundColor, "rgba(53, 132, 228, 1)");
});

test("setting its colour repaints the swatch and reports", () => {
  const said = [];
  const { el, view } = well({
    color: "#000000",
    action: (w, colour) => said.push(colour),
  });

  view.setColor(new Color(255, 0, 0));
  assert.equal(
    el.querySelectorAll("i")[0].style.backgroundColor,
    "rgba(255, 0, 0, 1)",
  );
  assert.deepEqual(
    said.map((c) => c.toHexString()),
    ["#FF0000"],
  );

  // The same colour again is not a change.
  view.setColor(new Color(255, 0, 0));
  assert.equal(said.length, 1);
});

test("pressing it opens a chooser, and pressing it again does not build another", () => {
  const { view } = well({ color: "#3584E4" });

  view.click({});
  const first = view.popOver;
  assert.ok(first, "a popover was made for it");
  assert.equal(first.visible, true);
  assert.ok(
    view.chooser.color.equals(new Color(53, 132, 228)),
    "showing the well's colour",
  );

  first.hide();
  view.click({});
  assert.equal(view.popOver, first, "the same one is shown again");
});

test("what the chooser reports, the well takes and passes on", () => {
  const said = [];
  const { view } = well({
    color: "#000000",
    action: (w, colour) => said.push(colour),
  });

  view.click({});
  view.chooser.setColor(new Color(53, 132, 228));

  assert.ok(view.color.equals(new Color(53, 132, 228)));
  assert.deepEqual(
    said.map((c) => c.toHexString()),
    ["#3584E4"],
  );
});

test("and a colour picked outright puts the chooser away", () => {
  const { view } = well();

  view.click({});
  view.chooser.pickSwatch(0xff0000);
  assert.equal(view.popOver.visible, false);
});

test("a disabled well opens nothing", () => {
  const { view } = well({ color: "#3584E4", enabled: "false" });

  view.click({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
  assert.equal(view.popOver, undefined);
});
