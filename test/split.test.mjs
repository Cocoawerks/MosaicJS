// SplitView, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no layout here, so how wide a pane ends up is not what these check.
// What they check is what the panel does: which pane takes the length, what a
// drag does to it, where it stops, and what shutting one away leaves behind.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const { SplitView, SplitViewFlex, Orientation } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/** Mount a panel with something in each pane. */
function make(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(SplitView, host, {
    ...props,
    children: [
      h("nav", { slot: "topLeft" }, "sidebar"),
      h("section", { slot: "bottomRight" }, "content"),
    ],
  }).view;

  const el = host.childNodes[0];
  return {
    view,
    el,
    topLeft: el.childNodes[0],
    divider: el.childNodes[1],
    bottomRight: el.childNodes[2],
  };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

/** Drag the divider by `dx`/`dy`, as a pointer would. */
function drag(panel, { dx = 0, dy = 0 } = {}) {
  panel.divider.dispatchEvent({
    type: "pointerdown",
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    preventDefault: () => {},
  });
  panel.divider.dispatchEvent({
    type: "pointermove",
    clientX: 100 + dx,
    clientY: 100 + dy,
    pointerId: 1,
  });
  panel.divider.dispatchEvent({ type: "pointerup", pointerId: 1 });
}

// --- what it draws -----------------------------------------------------------

test("draws the ported markup: two panes with a divider between them", () => {
  const { el, topLeft, divider, bottomRight } = make();

  assert.deepEqual(classesOf(el), ["v-SplitView", "row"]);
  assert.ok(classesOf(topLeft).includes("v-SplitView-pane"));
  assert.ok(classesOf(divider).includes("v-SplitDivider"));
  assert.ok(classesOf(bottomRight).includes("v-SplitView-pane"));

  assert.equal(topLeft.childNodes[0].tagName, "nav");
  assert.equal(bottomRight.childNodes[0].tagName, "section");
  assert.equal(divider.childNodes[0].tagName, "b");
});

test("a child naming no pane goes in the one that comes first", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const el = host.childNodes[0] ?? null;

  mount(SplitView, host, { children: [h("p", {}, "alone")] });
  const panes = host.childNodes[0].childNodes;
  assert.equal(panes[0].childNodes[0].tagName, "p");
  assert.equal(panes[2].childNodes.length, 0);
  assert.equal(el, null);
});

test("the orientation says which way the panes sit", () => {
  assert.deepEqual(classesOf(make().el), ["v-SplitView", "row"]);
  assert.deepEqual(classesOf(make({ orientation: Orientation.VERTICAL }).el), [
    "v-SplitView",
    "column",
  ]);
});

test("the divider says what it is to a reader", () => {
  const across = make();
  assert.equal(across.divider.getAttribute("role"), "separator");
  // A panel whose panes sit side by side is divided by a vertical line.
  assert.equal(across.divider.getAttribute("aria-orientation"), "vertical");

  const down = make({ orientation: Orientation.VERTICAL });
  assert.equal(down.divider.getAttribute("aria-orientation"), "horizontal");
});

test("a hairline divider loses its sash and takes a hover line instead", () => {
  assert.equal(classesOf(make().divider).includes("thin"), false);
  assert.ok(classesOf(make({ dividerThickness: "1" }).divider).includes("thin"));
});

// --- which pane takes the length ---------------------------------------------

test("the static pane is the one that does not flex", () => {
  const { view, topLeft, bottomRight } = make({ staticPaneLength: "220" });

  // Flexing top-left: the bottom-right pane is the one with a length.
  assert.equal(topLeft.style.flex, "1");
  assert.equal(bottomRight.style.flex, "unset");
  assert.equal(bottomRight.style.width, "220px");
  assert.equal(view.paneLength, 220);
});

test("and the other way round when the other pane flexes", () => {
  const { topLeft, bottomRight } = make({
    flex: SplitViewFlex.BOTTOM_RIGHT,
    staticPaneLength: "180",
  });

  assert.equal(bottomRight.style.flex, "1");
  assert.equal(topLeft.style.flex, "unset");
  assert.equal(topLeft.style.width, "180px");
});

test("a panel of panes stacked one above the other sizes by height", () => {
  const { bottomRight } = make({
    orientation: Orientation.VERTICAL,
    staticPaneLength: "150",
  });

  assert.equal(bottomRight.style.height, "150px");
  assert.equal(bottomRight.style.width, "100%");
});

// --- dragging ----------------------------------------------------------------

test("dragging the divider changes the static pane's length", () => {
  const panel = make({ staticPaneLength: "200" });

  // The static pane is the far one, so dragging towards it shortens it.
  drag(panel, { dx: 30 });
  assert.equal(panel.view.paneLength, 170);

  drag(panel, { dx: -50 });
  assert.equal(panel.view.paneLength, 220);
});

test("which way it runs follows whichever pane flexes", () => {
  const panel = make({
    flex: SplitViewFlex.BOTTOM_RIGHT,
    staticPaneLength: "200",
  });

  // The static pane is the near one now, so dragging right lengthens it.
  drag(panel, { dx: 30 });
  assert.equal(panel.view.paneLength, 230);
});

test("a panel stacked the other way follows the pointer down the screen", () => {
  const panel = make({
    orientation: Orientation.VERTICAL,
    flex: SplitViewFlex.BOTTOM_RIGHT,
    staticPaneLength: "100",
  });

  drag(panel, { dy: 40, dx: 999 });
  assert.equal(panel.view.paneLength, 140, "across the panel counts for nothing");
});

test("a drag stops where the bounds say", () => {
  const panel = make({
    staticPaneLength: "200",
    minStaticPaneLength: "120",
    maxStaticPaneLength: "300",
  });

  drag(panel, { dx: 500 });
  assert.equal(panel.view.paneLength, 120);

  drag(panel, { dx: -500 });
  assert.equal(panel.view.paneLength, 300);
});

test("the length is reported as it changes", () => {
  const seen = [];
  const panel = make({
    staticPaneLength: "200",
    action: (_, length) => seen.push(length),
  });

  drag(panel, { dx: 10 });
  assert.deepEqual(seen, [190]);
});

test("a press that is not the primary button starts nothing", () => {
  const panel = make({ staticPaneLength: "200" });

  panel.divider.dispatchEvent({
    type: "pointerdown",
    button: 2,
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    preventDefault: () => {},
  });
  panel.divider.dispatchEvent({ type: "pointermove", clientX: 160, pointerId: 1 });
  assert.equal(panel.view.paneLength, 200);
});

test("a divider with nowhere to go cannot be dragged", () => {
  const panel = make({
    staticPaneLength: "200",
    minStaticPaneLength: "200",
    maxStaticPaneLength: "200",
  });

  assert.equal(panel.view.dividerEnabled, false);
  assert.equal(panel.divider.style.pointerEvents, "none");

  drag(panel, { dx: 40 });
  assert.equal(panel.view.paneLength, 200);
});

// --- shutting a pane away ----------------------------------------------------

test("collapsing takes the pane and the divider with it", () => {
  const panel = make({ staticPaneLength: "220" });

  panel.view.collapse();
  assert.equal(panel.view.collapsed, true);
  assert.equal(panel.view.paneLength, 0);
  assert.ok(classesOf(panel.el).includes("collapsed"));

  const divider = panel.el.childNodes[1];
  assert.equal(divider.style.width, "0");
  assert.equal(divider.style.height, "0");
});

test("and expanding puts it back the length it was", () => {
  const panel = make({ staticPaneLength: "220" });

  panel.view.collapse();
  panel.view.expand();

  assert.equal(panel.view.collapsed, false);
  assert.equal(panel.view.paneLength, 220);
  assert.equal(classesOf(panel.el).includes("collapsed"), false);
});

test("a length set while it is shut is what it opens to", () => {
  const panel = make({ staticPaneLength: "220" });

  panel.view.collapse();
  panel.view.expand();
  panel.view.staticPaneLength = 300;
  assert.equal(panel.view.paneLength, 300);

  panel.view.collapse();
  panel.view.expand();
  assert.equal(panel.view.paneLength, 300);
});

test("collapsing twice does nothing the second time, and says so once", () => {
  const seen = [];
  const panel = make({
    staticPaneLength: "220",
    onCollapse: () => seen.push("shut"),
    onExpand: () => seen.push("open"),
  });

  panel.view.collapse();
  panel.view.collapse();
  panel.view.expand();
  panel.view.expand();

  assert.deepEqual(seen, ["shut", "open"]);
});

test("toggle shuts an open pane and opens a shut one", () => {
  const panel = make({ staticPaneLength: "220" });

  panel.view.toggle();
  assert.equal(panel.view.collapsed, true);
  panel.view.toggle();
  assert.equal(panel.view.collapsed, false);
});

test("a shut divider cannot be dragged", () => {
  const panel = make({ staticPaneLength: "220" });
  panel.view.collapse();

  assert.equal(panel.view.dividerEnabled, false);
  drag(panel, { dx: 40 });
  assert.equal(panel.view.paneLength, 0);
});
