// Menu, MenuItem, MenuButton and Tooltip, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { Menu, MenuButton, MenuItem, MenuItemSeparator, Tooltip } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const point = (el, type) => el.dispatchEvent({ type });
const keyDown = (el, key) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    preventDefault: () => (prevented = true),
  });
  return prevented;
};

/** The items a menu is given: two, a rule, and one that cannot be chosen. */
const someItems = () => [
  h(MenuItem, { text: "Cut", value: "cut" }),
  h(MenuItem, { text: "Copy", value: "copy" }),
  h(MenuItem, { separator: "true" }),
  h(MenuItem, { text: "Paste", value: "paste", enabled: "false" }),
];

/** Mount a menu, and hand back what a test needs to work it. */
function menu(props = {}, children = someItems()) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const anchor = document.createElement("button");
  document.body.appendChild(anchor);

  const view = mount(Menu, host, { ...props, children }).view;
  const el = host.childNodes[0];
  return { host, anchor, view, el, items: () => el.querySelectorAll("li") };
}

/** Which line is the active one, by what it reads. */
const activeText = (items) =>
  items
    .filter((li) => classesOf(li).includes("active"))
    .map((li) => li.textContent)[0] ?? null;

// --- the menu ----------------------------------------------------------------

test("a menu is a popover holding a list of items", () => {
  const { el, items } = menu();

  assert.ok(classesOf(el).includes("v-PopOver"), "it is a popover");
  assert.ok(classesOf(el).includes("v-Menu"), "of a kind that has a face");
  // The panel is the menu, as it is in Java: the list inside it is plumbing.
  assert.equal(el.getAttribute("role"), "menu");
  assert.equal(el.querySelectorAll("ul")[0].getAttribute("role"), null);
  assert.equal(items().length, 4);
  assert.equal(items()[0].getAttribute("role"), "menuitem");
});

test("a rule is drawn as one, and says so", () => {
  const { items } = menu();

  assert.equal(items()[2].getAttribute("role"), "separator");
  assert.ok(classesOf(items()[2]).includes("v-MenuItem-Separator"));
  assert.equal(items()[2].textContent, "");
});

test("an item without an icon carries no class for one", () => {
  // The sheet indents a label by 36px for `.noIcon`, and the Java version puts
  // that class on nothing: an item says `hasIcon` or says nothing.
  const { items } = menu();

  assert.equal(classesOf(items()[0]).includes("noIcon"), false);
  assert.equal(classesOf(items()[0]).includes("hasIcon"), false);
});

test("an item that cannot be chosen says so too", () => {
  const { items } = menu();

  assert.equal(items()[3].getAttribute("aria-disabled"), "true");
  assert.ok(classesOf(items()[3]).includes("is-disabled"));
});

test("a menu on its own points at nothing", () => {
  const { el } = menu();

  assert.ok(classesOf(el.childNodes[0]).includes("PopOver-callout-none"));
});

test("but one dropped from a menu button points back at it", () => {
  // `menu.setHasCallout(true)` in MenuButton.java, and the alignment left
  // alone, so the menu is centred under the button rather than left-aligned.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(MenuButton, host, {
    text: "Edit",
    children: someItems(),
  }).view;

  view.pointerDown({
    button: 0,
    preventDefault: () => {},
  });
  assert.equal(view.menu.callout, true);
  assert.equal(view.menu.alignLeft, false);
});

test("pointing at an item makes it the active one, and leaving unmakes it", () => {
  const { view, items } = menu();

  point(items()[1], "pointerenter");
  assert.equal(view.activeValue, "copy");
  assert.equal(activeText(items()), "Copy");

  point(items()[1], "pointerleave");
  assert.equal(view.activeValue, null);
});

test("neither a rule nor a disabled item can be pointed at", () => {
  const { view, items } = menu();

  point(items()[2], "pointerenter");
  point(items()[3], "pointerenter");
  assert.equal(view.activeValue, null);
});

test("clicking an item chooses it, and puts the menu away", () => {
  const chosen = [];
  const { view, anchor, items } = menu({
    action: (m, value) => chosen.push(value),
  });
  view.alignWith(anchor);

  click(items()[0]);
  assert.deepEqual(chosen, ["cut"]);
  assert.equal(view.visible, false);
});

test("and an item may be answered on its own", () => {
  const said = [];
  const { view, items } = menu({}, [
    h(MenuItem, {
      text: "Cut",
      value: "cut",
      action: (m, value) => said.push(value),
    }),
  ]);

  click(items()[0]);
  assert.deepEqual(said, ["cut"]);
});

test("a disabled item cannot be chosen at all", () => {
  const chosen = [];
  const { view, anchor, items } = menu({
    action: (m, value) => chosen.push(value),
  });
  view.alignWith(anchor);

  click(items()[3]);
  assert.deepEqual(chosen, []);
  assert.equal(view.visible, true, "and the menu stays up");
});

test("the arrows walk the lines that can be chosen, and stop at the ends", () => {
  const { view, el, items } = menu();

  assert.ok(keyDown(el, "ArrowDown"), "the key is taken");
  assert.equal(view.activeValue, "cut", "from nothing, the first");
  keyDown(el, "ArrowDown");
  assert.equal(view.activeValue, "copy");
  keyDown(el, "ArrowDown");
  assert.equal(
    view.activeValue,
    "copy",
    "the rule and the disabled line are passed over",
  );

  keyDown(el, "ArrowUp");
  assert.equal(view.activeValue, "cut");
  keyDown(el, "ArrowUp");
  assert.equal(view.activeValue, "cut", "and it stops at the first");
  assert.equal(activeText(items()), "Cut");
});

test("Enter chooses whatever is active", () => {
  const chosen = [];
  const { view, el, anchor } = menu({
    action: (m, value) => chosen.push(value),
  });
  view.alignWith(anchor);

  keyDown(el, "ArrowDown");
  keyDown(el, "Enter");
  assert.deepEqual(chosen, ["cut"]);
  assert.equal(view.visible, false);
});

test("and a menu put away forgets what was active", () => {
  const { view, el, anchor } = menu();
  view.alignWith(anchor);

  keyDown(el, "ArrowDown");
  assert.equal(view.activeValue, "cut");

  view.hide();
  assert.equal(view.activeValue, null);
});

// --- the button --------------------------------------------------------------

/** Mount a menu button over the items above. */
function menuButton(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(MenuButton, host, {
    text: "Edit",
    ...props,
    children: someItems(),
  }).view;
  return { host, view, el: host.childNodes[0] };
}

test("a menu button says it has a menu, and has none until it is pressed", () => {
  const { el, view } = menuButton();

  assert.equal(el.getAttribute("aria-haspopup"), "menu");
  assert.equal(el.getAttribute("aria-expanded"), "false");
  assert.equal(view.menu, undefined);
  assert.equal(
    el.textContent,
    "Edit",
    "and its children are the menu's, not its own",
  );
});

test("pressing it shows the menu; pressing it again puts it away", () => {
  const { el, view } = menuButton();

  view.pointerDown({
    button: 0,
    preventDefault: () => {},
  });
  assert.ok(view.menu, "a menu was built for it");
  assert.equal(view.menu.visible, true);
  assert.equal(el.getAttribute("aria-expanded"), "true");

  view.pointerDown({
    button: 0,
    preventDefault: () => {},
  });
  assert.equal(view.menu.visible, false);
  assert.equal(el.getAttribute("aria-expanded"), "false");
});

test("what the menu chose is what the button reports", () => {
  const said = [];
  const { view } = menuButton({ action: (button, value) => said.push(value) });

  view.pointerDown({
    button: 0,
    preventDefault: () => {},
  });
  view.menu.choose("copy");

  assert.deepEqual(said, ["copy"]);
  assert.equal(view.menu.visible, false);
  assert.equal(view.on, false, "and the button came back up");
});

// --- the tooltip -------------------------------------------------------------

test("a tooltip waits for the pointer to rest, then shows its words", async () => {
  const target = document.createElement("button");
  document.body.appendChild(target);

  const tooltip = Tooltip.attach(target, "What this does");
  assert.equal(tooltip.visible, false);

  point(target, "pointerenter");
  assert.equal(tooltip.visible, false, "not straight away");

  await new Promise((resolve) => setTimeout(resolve, tooltip.showDelay + 20));
  assert.equal(tooltip.visible, true);
  assert.equal(tooltip.node.textContent, "What this does");
  assert.ok(classesOf(tooltip.node).includes("v-Tooltip"));

  point(target, "pointerleave");
  assert.equal(tooltip.visible, false);
  tooltip.dispose();
});

test("and shows nothing at all if the pointer leaves first", async () => {
  const target = document.createElement("button");
  document.body.appendChild(target);
  const tooltip = Tooltip.attach(target, "What this does");

  point(target, "pointerenter");
  point(target, "pointerleave");
  await new Promise((resolve) => setTimeout(resolve, tooltip.showDelay + 20));

  assert.equal(tooltip.visible, false);
  tooltip.dispose();
});

test("a tooltip turned off explains nothing", async () => {
  const target = document.createElement("button");
  document.body.appendChild(target);
  const tooltip = Tooltip.attach(target, "What this does");

  tooltip.setActive(false);
  point(target, "pointerenter");
  await new Promise((resolve) => setTimeout(resolve, tooltip.showDelay + 20));

  assert.equal(tooltip.visible, false);
  tooltip.dispose();
});

test("nor does one hanging off something disabled", async () => {
  const target = document.createElement("button");
  target.setAttribute("aria-disabled", "true");
  document.body.appendChild(target);
  const tooltip = Tooltip.attach(target, "What this does");

  point(target, "pointerenter");
  await new Promise((resolve) => setTimeout(resolve, tooltip.showDelay + 20));

  assert.equal(tooltip.visible, false);
  tooltip.dispose();
});

// --- MenuItemSeparator -------------------------------------------------------
//
// A rule written as what it is rather than as a setting on an item. The Java
// version is a MenuItem subclass, and so is this — which is why the menu has to
// take a kind of MenuItem for a line, not MenuItem itself.

/** The same four lines, with the rule written as a MenuItemSeparator. */
const itemsWithSeparator = () => [
  h(MenuItem, { text: "Cut", value: "cut" }),
  h(MenuItem, { text: "Copy", value: "copy" }),
  h(MenuItemSeparator, {}),
  h(MenuItem, { text: "Paste", value: "paste", enabled: "false" }),
];

test("a MenuItemSeparator draws the rule an item asked to be a rule draws", () => {
  const { items } = menu({}, itemsWithSeparator());

  assert.equal(items().length, 4, "the menu takes it for a line of its own");
  assert.equal(items()[2].getAttribute("role"), "separator");
  assert.ok(classesOf(items()[2]).includes("v-MenuItem-Separator"));
  assert.equal(items()[2].textContent, "");
});

test("and is no more choosable than the other way of writing one", () => {
  const { view } = menu({}, itemsWithSeparator());

  // Not among the lines a pointer or a key can land on...
  assert.deepEqual(
    view.liveItems.map((item) => item.value),
    ["cut", "copy"],
  );

  // ...and a step from the last live line has nowhere to go, rather than
  // landing on the rule that follows it.
  view.activate("copy");
  view.step(1);
  assert.equal(view.activeValue, "copy");

  view.step(-1);
  assert.equal(view.activeValue, "cut");
});

test("clicking one chooses nothing, and leaves the menu up", () => {
  const chosen = [];
  const { view, anchor, items } = menu(
    { action: (_, value) => chosen.push(value) },
    itemsWithSeparator(),
  );
  view.alignWith(anchor);

  click(items()[2]);
  assert.deepEqual(chosen, []);
  assert.equal(view.visible, true, "a rule is not an answer to the menu");

  // And the lines around it still are.
  click(items()[0]);
  assert.deepEqual(chosen, ["cut"]);
});
