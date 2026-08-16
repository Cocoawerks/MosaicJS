// ToolBar, ToolBarItem and ToolBarFlex, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no layout here, so what the bar measures has to be said out loud:
// the tests that exercise overflow give the bar a width and its items one, and
// what they check is which items it moved and what the menu then reads.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { ToolBar, ToolBarFlex, ToolBarItem } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const point = (el, type) => el.dispatchEvent({ type });

/** How wide a showing item is taken to be, and the bar it has to fit in. */
const ITEM_WIDTH = 100;
const OVERFLOW_WIDTH = 40;

/** Mount a bar over `children`, hand back what a test needs to work it. */
function toolbar(children, props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(ToolBar, host, { ...props, children }).view;
  const el = host.childNodes[0];
  return { host, view, el };
}

/** The four named items most of these tests are built from. */
const someItems = (props = {}) => [
  h(ToolBarItem, { text: "New", value: "new", ...props.new }),
  h(ToolBarItem, { text: "Open", value: "open", ...props.open }),
  h(ToolBarItem, { text: "Save", value: "save", ...props.save }),
  h(ToolBarItem, { text: "Share", value: "share", ...props.share }),
];

/** Every element the bar drew that is an item, in the order it holds them. */
const itemsOf = (el) =>
  el.childNodes.filter(
    (node) => node.nodeType === 1 && classesOf(node).includes("v-ToolBarItem"),
  );

/** And the slot the overflow button sits in. */
const overflowOf = (el) =>
  el.childNodes.find(
    (node) =>
      node.nodeType === 1 && classesOf(node).includes("v-ToolBar-overflow"),
  );

/** Whether an element is in the layout at all. */
const showing = (el) => el.style.display !== "none";

/**
 * Give the bar a width, and its items one each, so `reflow` has something to
 * measure. The bar's content is as wide as whatever is still showing — which is
 * what makes hiding an item narrow it, as a browser's layout would.
 */
function measurable(el, clientWidth) {
  // Written through a field, so a test can narrow or widen the bar again — a
  // resize is the whole reason the bar reflows.
  el.barWidth = clientWidth;
  Object.defineProperty(el, "clientWidth", { get: () => el.barWidth });
  Object.defineProperty(el, "scrollWidth", {
    get() {
      const items = itemsOf(el).filter(showing).length * ITEM_WIDTH;
      return items + (showing(overflowOf(el)) ? OVERFLOW_WIDTH : 0);
    },
  });
}

// --- the bar -----------------------------------------------------------------

test("a bar says what it is and holds what the markup put in it", () => {
  const { el } = toolbar(someItems());

  assert.deepEqual(classesOf(el), ["v-ToolBar"]);
  assert.equal(el.getAttribute("role"), "toolbar");
  assert.deepEqual(
    itemsOf(el).map((item) => item.textContent),
    ["New", "Open", "Save", "Share"],
  );
});

test("an item is a button wearing the toolbar's face", () => {
  const { el } = toolbar(someItems());
  const item = itemsOf(el)[0];

  assert.equal(item.tagName, "button");
  assert.ok(classesOf(item).includes("v-Button"), "it is a Button");
  assert.ok(classesOf(item).includes("v-ToolBarItem"), "of the toolbar's kind");
});

test("an item fires its action when it is clicked", () => {
  const fired = [];
  const { el } = toolbar([
    h(ToolBarItem, { text: "New", action: (item) => fired.push(item.text) }),
  ]);

  click(itemsOf(el)[0]);
  assert.deepEqual(fired, ["New"]);
});

test("a flexible gap is drawn, so what follows it can be pushed along", () => {
  const { el } = toolbar([
    h(ToolBarItem, { text: "New" }),
    h(ToolBarFlex, {}),
    h(ToolBarItem, { text: "Share" }),
  ]);

  const gap = el.childNodes.find(
    (node) => node.nodeType === 1 && classesOf(node).includes("v-ToolBar-flex"),
  );
  assert.ok(gap, "the gap is there");
  assert.equal(
    gap.getAttribute("aria-hidden"),
    "true",
    "and says it reads as nothing",
  );
});

// --- being absent ------------------------------------------------------------

test("a hidden item is left in the bar and taken out of the layout", () => {
  const { el } = toolbar(someItems({ save: { hidden: "true" } }));
  const items = itemsOf(el);

  assert.equal(items.length, 4, "it is still drawn");
  assert.equal(showing(items[2]), false, "and takes no room");
  assert.deepEqual(
    items.filter(showing).map((i) => i.textContent),
    ["New", "Open", "Share"],
  );
});

// --- overflow ----------------------------------------------------------------

test("nothing overflows while everything fits", () => {
  const { view, el } = toolbar(someItems());
  measurable(el, 4 * ITEM_WIDTH);
  view.reflow();

  assert.equal(view.overflowCount, 0);
  assert.equal(
    showing(overflowOf(el)),
    false,
    "the overflow button is not there",
  );
  assert.equal(view.menu, undefined, "and no menu was ever built");
  assert.deepEqual(itemsOf(el).filter(showing).length, 4);
});

test("the items that no longer fit leave from the trailing edge", () => {
  // Room for two items and the overflow button, and four items to place.
  const { view, el } = toolbar(someItems());
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  assert.equal(view.overflowCount, 2);
  assert.deepEqual(
    itemsOf(el)
      .filter(showing)
      .map((item) => item.textContent),
    ["New", "Open"],
    "the leading items survive longest",
  );
  assert.equal(
    showing(overflowOf(el)),
    true,
    "and the overflow button is there",
  );
});

test("what left the bar is what the overflow menu reads", () => {
  const { view, el } = toolbar(someItems());
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  assert.deepEqual(
    view.menu.items.map((item) => item.props.text),
    ["Save", "Share"],
    "in the order they sat in, not trailing-first",
  );
});

test("a hidden item is not in the bar, so it is not in the menu either", () => {
  const { view, el } = toolbar(someItems({ share: { hidden: "true" } }));
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  assert.deepEqual(
    view.menu.items.map((item) => item.props.text),
    ["Save"],
  );
});

test("a disabled item is dimmed in the menu as it is in the bar", () => {
  const { view, el } = toolbar(someItems({ share: { enabled: "false" } }));
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  assert.deepEqual(
    view.menu.items.map((item) => item.enabled),
    [true, false],
  );
});

test("choosing a line works the item it stands for", () => {
  const fired = [];
  const { view, el } = toolbar(
    someItems({ share: { action: (item) => fired.push(item.text) } }),
  );
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  view.menu.choose(view.menu.items.at(-1).value);
  assert.deepEqual(fired, ["Share"], "as if it had been clicked in the bar");
});

test("the overflow button latches while its menu is up", () => {
  const { view, el } = toolbar(someItems());
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  const button = overflowOf(el).childNodes[0];
  point(button, "pointerdown");
  click(button);
  assert.equal(view.overflowButton.on, true, "it is down");
  assert.equal(view.menu.open, true, "and the menu is up");

  point(button, "pointerdown");
  click(button);
  assert.equal(view.menu.open, false, "pressing it again puts the menu away");
});

test("however the menu is dismissed, the button comes back up with it", () => {
  const { view, el } = toolbar(someItems());
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();

  const button = overflowOf(el).childNodes[0];
  point(button, "pointerdown");
  click(button);
  view.menu.hide();

  assert.equal(view.overflowButton.on, false);
});

test("an item that fits again comes back to the bar", () => {
  const { view, el } = toolbar(someItems());
  measurable(el, 2 * ITEM_WIDTH + OVERFLOW_WIDTH);
  view.reflow();
  assert.equal(view.overflowCount, 2);

  // The bar was measured against a width it no longer has; a browser would
  // report the resize, and the reflow is what it would run.
  el.barWidth = 4 * ITEM_WIDTH;
  view.reflow();

  assert.equal(view.overflowCount, 0);
  assert.equal(itemsOf(el).filter(showing).length, 4);
  assert.equal(showing(overflowOf(el)), false);
});
