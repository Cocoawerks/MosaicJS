// TitleBar and TitleBarButton, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
// There is no layout here, so where the title lands is not what these check —
// that is checked in a browser. What they check is which region a child goes
// to, what the bar says about its title, and the arithmetic behind the width
// below which the strip refuses to shrink.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { TitleBar, TitleBarButton } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const point = (el, type) => el.dispatchEvent({ type });

/** Mount a bar, and hand back the strip and its three regions. */
function titlebar(props = {}, children = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(TitleBar, host, { ...props, children }).view;
  const el = host.childNodes[0];
  const region = (name) =>
    el.childNodes.find((node) =>
      classesOf(node).includes(`v-TitleBar-${name}`),
    );
  return {
    host,
    view,
    el,
    actions: region("actions"),
    title: region("title"),
    trailing: region("trailing"),
  };
}

// --- the strip ---------------------------------------------------------------

test("a bar is a strip of three regions", () => {
  const { el, actions, title, trailing } = titlebar({ title: "Settings" });

  assert.deepEqual(classesOf(el), ["v-TitleBar"]);
  assert.ok(actions && title && trailing, "all three are drawn");
  assert.equal(title.textContent, "Settings");
});

test("the title carries its full text, since a long one is cut", () => {
  const { title } = titlebar({ title: "A rather long document title" });
  const label = title.childNodes[0];

  assert.ok(classesOf(label).includes("v-TitleBar-label"));
  assert.equal(label.getAttribute("title"), "A rather long document title");
});

test("a bar with no title draws no label", () => {
  const { title } = titlebar();

  assert.equal(title.childNodes[0].style.display, "none");
  assert.equal(title.textContent, "");
});

// --- the regions -------------------------------------------------------------

test("a child goes to the region it names", () => {
  const { actions, title, trailing } = titlebar({ title: "Settings" }, [
    h(TitleBarButton, { slot: "actions", text: "Back" }),
    h(TitleBarButton, { slot: "trailing", text: "Ada" }),
  ]);

  assert.equal(actions.textContent, "Back");
  assert.equal(trailing.textContent, "Ada");
  assert.equal(
    title.textContent,
    "Settings",
    "and neither drifted into the title",
  );
});

test("a child that names no region sits beside the title", () => {
  // Which is where the Java version's `status` slot put a save pill.
  const { title } = titlebar({ title: "Settings" }, [h("span", {}, "Saved")]);

  assert.equal(title.textContent, "SettingsSaved");
});

// --- how narrow the strip may get --------------------------------------------

test("the strip stops shrinking where the title would meet a side region", () => {
  const { view, el, actions, title, trailing } = titlebar({
    title: "Settings",
  });

  // title + 2 * (widest side + 16), which is the collision the bar is placed
  // to avoid: the title is centred on the bar, so each side must clear the
  // wider of the two.
  Object.defineProperty(title, "scrollWidth", { value: 120 });
  Object.defineProperty(actions, "offsetWidth", { value: 40 });
  Object.defineProperty(trailing, "offsetWidth", { value: 90 });
  view.updateMinWidth();

  assert.equal(el.style.minWidth, `${120 + 2 * (90 + 16)}px`);
});

test("a title longer than it can render does not widen the strip", () => {
  const { view, el, title } = titlebar({ title: "A very long title indeed" });

  // Capped at the 300px `.v-TitleBar-title` renders at, so an ellipsised
  // title contributes what it draws rather than what it says.
  Object.defineProperty(title, "scrollWidth", { value: 900 });
  view.updateMinWidth();

  assert.equal(el.style.minWidth, `${300 + 2 * 16}px`);
});

// --- the button --------------------------------------------------------------

test("a title bar button is a button wearing the bar's face", () => {
  const { trailing } = titlebar({}, [
    h(TitleBarButton, { slot: "trailing", text: "Ada" }),
  ]);
  const button = trailing.childNodes[0];

  assert.equal(button.tagName, "button");
  assert.ok(classesOf(button).includes("v-Button"), "it is a Button");
  assert.ok(
    classesOf(button).includes("v-TitleBarButton"),
    "of the bar's kind",
  );
});

test("a momentary button fires its action when it is clicked", () => {
  const fired = [];
  const { trailing } = titlebar({}, [
    h(TitleBarButton, {
      slot: "trailing",
      text: "Ada",
      action: (b) => fired.push(b.text),
    }),
  ]);

  click(trailing.childNodes[0]);
  assert.deepEqual(fired, ["Ada"]);
});

test("a latching button stays down until it is pressed again", () => {
  const { view, trailing } = titlebar({}, [
    h(TitleBarButton, { slot: "trailing", text: "Ada", toggle: "true" }),
  ]);
  // Read back through the bar each time: a redraw may put a fresh element
  // where the button was.
  const button = () => view.trailingNode.childNodes[0];

  point(button(), "pointerdown");
  assert.ok(classesOf(button()).includes("is-active"), "down");

  point(button(), "pointerdown");
  assert.equal(
    classesOf(button()).includes("is-active"),
    false,
    "and up again",
  );
});

// --- the menu bar item -------------------------------------------------------

const { MenuBarItem, MenuItem } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** The lines a bar item's menu is given. */
const someLines = () => [
  h(MenuItem, { text: "New", value: "new" }),
  h(MenuItem, { separator: "true" }),
  h(MenuItem, { text: "Close", value: "close" }),
];

/**
 * A title bar holding `count` menu bar items, and a way to work each of them.
 * Mounted as children of a real TitleBar, since a bar of them acting as one
 * control is most of what there is to check.
 */
function menuBar(count = 2, props = {}) {
  // Whichever item a previous bar left open, closed: which item is open is
  // the class's and not an instance's, so a bar left showing one would hand
  // over to the next bar built.
  MenuBarItem.openItem?.hideMenu();

  const { trailing, actions, view, el } = titlebar({}, [
    ...Array.from({ length: count }, (_, i) =>
      // The lines go as children of the tag, not as a `children` prop:
      // what a component is given as its nesting is what it draws with.
      h(
        MenuBarItem,
        { slot: "actions", text: `Menu ${i}`, ...props },
        ...someLines(),
      ),
    ),
  ]);
  const items = () => actions.childNodes.filter((node) => node.nodeType === 1);
  const viewOf = (i) => items()[i].__ibView;
  return { view, el, actions, trailing, items, viewOf };
}

test("a menu bar item is a title bar button that says it drops a menu", () => {
  const { items } = menuBar(1);
  const item = items()[0];

  assert.ok(
    classesOf(item).includes("v-TitleBarButton"),
    "it wears the bar's face",
  );
  assert.ok(classesOf(item).includes("v-MenuBarItem"), "and is one of these");
  assert.equal(item.getAttribute("aria-haspopup"), "menu");
  assert.equal(item.getAttribute("aria-expanded"), "false");
});

test("pressing it drops its menu, and pressing it again puts it away", () => {
  const { items, viewOf } = menuBar(1);

  point(items()[0], "pointerdown");
  assert.equal(viewOf(0).buttonState, "on", "the item latched");
  assert.equal(viewOf(0).menu.open, true, "and the menu is up");
  assert.equal(items()[0].getAttribute("aria-expanded"), "true");

  point(items()[0], "pointerdown");
  assert.equal(viewOf(0).menu.open, false);
  assert.equal(viewOf(0).buttonState, "off", "and the item came back up");
});

test("its menu drops from the item rather than pointing at it", () => {
  const { items, viewOf } = menuBar(1);
  point(items()[0], "pointerdown");
  const menu = viewOf(0).menu;

  assert.equal(menu.callout, false, "no callout");
  assert.equal(
    menu.alignLeft,
    true,
    "and its left edge lines up with the item's",
  );
  assert.ok(
    classesOf(menu.node).includes("v-MenuBarItem-menu"),
    "the panel says what it hangs from, so its corners can meet the item",
  );
});

test("the item's action is what its menu chose, not the press", () => {
  const chosen = [];
  const { items, viewOf } = menuBar(1, {
    action: (item, value) => chosen.push(value),
  });

  point(items()[0], "pointerdown");
  assert.deepEqual(chosen, [], "pressing it says nothing to the application");

  viewOf(0).menu.choose("close");
  assert.deepEqual(chosen, ["close"]);
  assert.equal(viewOf(0).buttonState, "off", "and choosing put the item back up");
});

test("however the menu closes, the item comes back up with it", () => {
  const { items, viewOf } = menuBar(1);

  point(items()[0], "pointerdown");
  viewOf(0).menu.hide();
  assert.equal(viewOf(0).buttonState, "off");
  assert.equal(items()[0].getAttribute("aria-expanded"), "false");
});

test("with one menu up, the pointer moving to a sibling takes it over", () => {
  // A bar of them is one control while a menu is open: no second press.
  const { items, viewOf } = menuBar(2);

  point(items()[0], "pointerdown");
  point(items()[1], "pointerenter");

  assert.equal(viewOf(0).buttonState, "off", "the first came up");
  assert.equal(viewOf(0).menu.open, false, "and its menu went");
  assert.equal(viewOf(1).buttonState, "on", "the second went down");
  assert.equal(viewOf(1).menu.open, true, "and dropped its own");
});

test("with nothing open, the pointer merely passing over opens nothing", () => {
  const { items, viewOf } = menuBar(2);

  point(items()[1], "pointerenter");
  assert.equal(viewOf(1).buttonState, "off");
  assert.equal(viewOf(1).menu, undefined, "no menu was ever built");
});

test("the chevron is off unless it is asked for", () => {
  assert.equal(menuBar(1).items()[0].querySelectorAll("i.chevron").length, 0);
  assert.equal(
    menuBar(1, { showChevron: "true" }).items()[0].querySelectorAll("i.chevron")
      .length,
    1,
    "and sits after the label, at the trailing edge",
  );
});
