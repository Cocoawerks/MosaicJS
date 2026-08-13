// Radio and RadioGroup, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {mount, h} = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const {Radio, RadioGroup} = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/** The options a group is given, the way markup nests them. */
const options = (...specs) =>
  specs.map(([text, value, enabled]) => h(Radio, { text, value, enabled }));

/** Mount a group and hand back its view, list element and options. */
function open(props = {}, children = options(["Small", "small"], ["Medium", "medium"])) {
  const host = document.createElement("div");
  const view = mount(RadioGroup, host, { ...props, children }).view;
  const el = host.childNodes[0];
  return { host, view, el, items: [...el.childNodes] };
}

const classesOf = (el) => el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const keyDown = (el, key) => {
  let prevented = false;
  el.dispatchEvent({ type: "keydown", key, preventDefault: () => (prevented = true) });
  return prevented;
};
const indicatorOf = (item) => item.childNodes[0];
const chosen = (items) => items.findIndex((i) => i.getAttribute("aria-checked") === "true");

test("draws the ported markup: ul[role=radiogroup] > li[role=radio]", () => {
  const { el, items } = open();

  assert.equal(el.tagName, "ul");
  assert.equal(el.getAttribute("role"), "radiogroup");
  assert.deepEqual(classesOf(el), ["v-RadioGroup"]);

  assert.equal(items.length, 2);
  assert.equal(items[0].tagName, "li");
  assert.equal(items[0].getAttribute("role"), "radio");
  assert.deepEqual(classesOf(items[0]), ["v-Radio"]);
  assert.deepEqual(classesOf(indicatorOf(items[0])), ["indicator"]);
  assert.equal(items[0].childNodes[1].textContent, "Small");
});

test("the group holds the choice, and only one option wears it", () => {
  const { items } = open({ value: "medium" });

  assert.equal(chosen(items), 1);
  assert.ok(classesOf(indicatorOf(items[1])).includes("checked"));
  assert.equal(classesOf(indicatorOf(items[0])).includes("checked"), false);
});

test("clicking an option chooses it, and unchooses the other", () => {
  const { view, items } = open({ value: "small" });

  click(items[1]);
  assert.equal(view.value, "medium");

  const after = [...view.node.childNodes];
  assert.equal(chosen(after), 1);
  assert.ok(classesOf(indicatorOf(after[1])).includes("checked"));
  assert.equal(classesOf(indicatorOf(after[0])).includes("checked"), false);
});

test("the action fires with the value chosen", () => {
  const fired = [];
  const { view, items } = open({
    value: "small",
    action: (group, value) => fired.push([group, value]),
  });

  click(items[1]);
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], view, "the group fires as itself");
  assert.equal(fired[0][1], "medium");

  // Choosing the one already chosen is not a change.
  click([...view.node.childNodes][1]);
  assert.equal(fired.length, 1);
});

test("assigning to value chooses without firing the action", () => {
  const fired = [];
  const { view } = open({ value: "small", action: () => fired.push(1) });

  view.value = "medium";
  assert.equal(chosen([...view.node.childNodes]), 1);
  assert.deepEqual(fired, []);

  view.setValue("small", true);
  assert.deepEqual(fired, [1]);
});

test("a group is one tab stop: only the chosen option is in it", () => {
  const { items } = open({ value: "medium" });

  assert.equal(items[0].getAttribute("tabindex"), "-1");
  assert.equal(items[1].getAttribute("tabindex"), "0");
});

test("the arrow keys move the choice, and stop at the ends", () => {
  const { el, view } = open({ value: "small" });

  assert.ok(keyDown(el, "ArrowDown"), "the key is consumed");
  assert.equal(view.value, "medium");

  keyDown(el, "ArrowRight");
  assert.equal(view.value, "medium", "there is nothing past the last one");

  keyDown(el, "ArrowUp");
  assert.equal(view.value, "small");
  keyDown(el, "ArrowLeft");
  assert.equal(view.value, "small", "nor before the first");

  assert.equal(keyDown(el, "a"), false, "another key is left alone");
});

test("the arrow keys skip a disabled option rather than landing on it", () => {
  const { el, view } = open(
    { value: "small" },
    options(["Small", "small"], ["Medium", "medium", false], ["Large", "large"]),
  );

  keyDown(el, "ArrowDown");
  assert.equal(view.value, "large");
});

test("a disabled option ignores a click", () => {
  const fired = [];
  const { view, items } = open(
    { value: "small", action: () => fired.push(1) },
    options(["Small", "small"], ["Medium", "medium", false]),
  );

  click(items[1]);
  assert.equal(view.value, "small");
  assert.deepEqual(fired, []);
  assert.ok(classesOf(items[1]).includes("is-disabled"));
});

test("disabling the group disables every option", () => {
  const { el, view, items } = open({ value: "small", enabled: false });

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.ok(items.every((i) => classesOf(i).includes("is-disabled")));
  assert.ok(items.every((i) => i.getAttribute("tabindex") === "-1"), "and out of the tab order");

  click(items[1]);
  assert.equal(view.value, "small");
  assert.equal(keyDown(el, "ArrowDown"), false);
  assert.equal(view.value, "small");
});
