// The CheckBox component, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {mount} = await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const {CheckBox} = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/** Mount a checkbox and hand back its view, root element and host. */
function open(props = {}) {
  const host = document.createElement("div");
  const view = mount(CheckBox, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

// The scope class is left out: it says which module styled the element, not
// what the component put there. The compiler appends it last.
const classesOf = (el) => el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const keyDown = (el, key) => {
  let defaultPrevented = false;
  el.dispatchEvent({ type: "keydown", key, preventDefault: () => (defaultPrevented = true) });
  return defaultPrevented;
};

const indicatorOf = (el) => el.childNodes[1];
const checkOf = (el) => indicatorOf(el).childNodes[0];

test("draws the ported markup: div[role=checkbox] > span + div.indicator > div.check", () => {
  const { el } = open({ text: "Remember me" });

  assert.equal(el.tagName, "div");
  assert.equal(el.getAttribute("role"), "checkbox");
  assert.deepEqual(classesOf(el), ["v-CheckBox"]);

  const label = el.childNodes[0];
  assert.equal(label.tagName, "span");
  assert.equal(label.textContent, "Remember me");

  assert.deepEqual(classesOf(indicatorOf(el)), ["indicator"]);
  assert.deepEqual(classesOf(checkOf(el)), ["check"]);
});

test("it is focusable, and labelled by its own label", () => {
  const { el } = open({ text: "Remember me" });

  assert.equal(el.getAttribute("tabindex"), "0");

  const id = el.childNodes[0].getAttribute("id");
  assert.ok(id, "the label has an id to be named by");
  assert.equal(el.getAttribute("aria-labelledby"), id);
});

test("two checkboxes do not share a label id", () => {
  const first = open({ text: "One" }).el.childNodes[0].getAttribute("id");
  const second = open({ text: "Two" }).el.childNodes[0].getAttribute("id");
  assert.notEqual(first, second);
});

test("unchecked to start, and aria-checked says so", () => {
  const { el, view } = open({ text: "x" });

  assert.equal(view.value, false);
  assert.equal(el.getAttribute("aria-checked"), "false");
});

test("value comes from the markup that rendered it", () => {
  const { el, view } = open({ text: "x", value: true });

  assert.equal(view.value, true);
  assert.equal(el.getAttribute("aria-checked"), "true");
  assert.ok(classesOf(indicatorOf(el)).includes("checked"));
  assert.ok(classesOf(checkOf(el)).includes("checked"));
});

test("clicking checks it, and clicking again unchecks it", () => {
  const { el, view } = open({ text: "x" });

  click(el);
  assert.equal(view.value, true);
  assert.equal(el.getAttribute("aria-checked"), "true");
  assert.ok(classesOf(indicatorOf(el)).includes("checked"), "the indicator is marked");
  assert.ok(classesOf(checkOf(el)).includes("checked"), "and so is the check");

  click(el);
  assert.equal(view.value, false);
  assert.equal(el.getAttribute("aria-checked"), "false");
  assert.equal(classesOf(indicatorOf(el)).includes("checked"), false);
});

test("Enter and Space toggle it, and the key is consumed", () => {
  const { el, view } = open({ text: "x" });

  assert.ok(keyDown(el, "Enter"), "Enter is handled, not left to the page");
  assert.equal(view.value, true);

  assert.ok(keyDown(el, " "), "Space too");
  assert.equal(view.value, false);
});

test("another key is left alone", () => {
  const { el, view } = open({ text: "x" });

  assert.equal(keyDown(el, "a"), false);
  assert.equal(view.value, false);
});

test("the action fires with the new value when the user changes it", () => {
  const fired = [];
  const { el, view } = open({ text: "x", action: (control, value) => fired.push([control, value]) });

  click(el);
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], view, "the control fires as itself");
  assert.equal(fired[0][1], true, "with the value it now has");

  click(el);
  assert.deepEqual(fired.map((f) => f[1]), [true, false]);
});

test("assigning to value updates the DOM without firing the action", () => {
  const fired = [];
  const { el, view } = open({ text: "x", action: () => fired.push(1) });

  view.value = true;
  assert.equal(el.getAttribute("aria-checked"), "true");
  assert.deepEqual(fired, [], "an owner's own assignment is not a change by the user");

  // setValue says explicitly whether it counts as one, as in Java.
  view.setValue(false, true);
  assert.deepEqual(fired, [1]);
});

test("setting the value it already has does nothing at all", () => {
  const fired = [];
  const { view } = open({ text: "x", value: true, action: () => fired.push(1) });

  view.setValue(true, true);
  assert.deepEqual(fired, []);
});

test("a disabled checkbox ignores the pointer and the keyboard", () => {
  const { el, view } = open({ text: "x", enabled: false });

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.equal(el.getAttribute("aria-disabled"), "true");
  assert.equal(el.getAttribute("tabindex"), "-1", "and is out of the tab order");

  click(el);
  assert.equal(view.value, false);
  assert.equal(keyDown(el, " "), false);
  assert.equal(view.value, false);
});

test("text can be replaced after mounting", () => {
  const { el, view } = open({ text: "Before" });

  view.text = "After";
  assert.equal(el.childNodes[0].textContent, "After");
});

test("markup says true with a string, and it means true", () => {
  // `<CheckBox value="true"/>` is the only way markup can say it.
  assert.equal(open({ text: "x", value: "true" }).view.value, true);
  assert.equal(open({ text: "x", value: "false" }).view.value, false);
  assert.equal(open({ text: "x", enabled: "false" }).view.enabled, false);
});
