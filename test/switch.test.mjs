// The Switch component, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { Switch } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** Mount a switch and hand back its view, root element and indicator. */
function open(props = {}) {
  const host = document.createElement("div");
  const view = mount(Switch, host, props).view;
  const el = host.childNodes[0];
  return { host, view, el, indicator: el.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const keyDown = (el, key) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    preventDefault: () => (prevented = true),
  });
  return prevented;
};

test("draws the ported markup: div[role=checkbox] > div.indicator + span", () => {
  const { el, indicator } = open({ text: "Wi-Fi" });

  assert.equal(el.tagName, "div");
  assert.equal(el.getAttribute("role"), "checkbox");
  assert.deepEqual(classesOf(el), ["v-Switch"]);

  // The track comes first here, where a CheckBox puts its label first.
  assert.deepEqual(classesOf(indicator), ["indicator"]);
  assert.equal(el.childNodes[1].tagName, "span");
  assert.equal(el.childNodes[1].textContent, "Wi-Fi");
});

test("the state lives on the root, which is what slides the knob", () => {
  const { el, view } = open({ text: "x" });

  assert.equal(view.value, false);
  assert.equal(classesOf(el).includes("checked"), false);
  assert.equal(el.getAttribute("aria-checked"), "false");

  view.value = true;
  assert.ok(classesOf(el).includes("checked"));
  assert.equal(el.getAttribute("aria-checked"), "true");
});

test("it is focusable and labelled by its own label", () => {
  const { el } = open({ text: "Wi-Fi" });

  assert.equal(el.getAttribute("tabindex"), "0");
  assert.equal(
    el.getAttribute("aria-labelledby"),
    el.childNodes[1].getAttribute("id"),
  );
});

test("clicking flips it, and clicking again flips it back", () => {
  const { el, view } = open({ text: "x" });

  click(el);
  assert.equal(view.value, true);
  click(el);
  assert.equal(view.value, false);
});

test("Enter and Space flip it, and the key is consumed", () => {
  const { el, view } = open({ text: "x" });

  assert.ok(keyDown(el, "Enter"));
  assert.equal(view.value, true);
  assert.ok(keyDown(el, " "));
  assert.equal(view.value, false);
  assert.equal(keyDown(el, "a"), false, "another key is left alone");
});

test("the action fires with the new value when the user flips it", () => {
  const fired = [];
  const { el, view } = open({
    text: "x",
    action: (control, value) => fired.push([control, value]),
  });

  click(el);
  assert.deepEqual(
    fired.map((f) => f[1]),
    [true],
  );
  assert.equal(fired[0][0], view);

  view.value = false;
  assert.deepEqual(
    fired.map((f) => f[1]),
    [true],
    "an assignment is not a flip by the user",
  );

  view.setValue(true, true);
  assert.deepEqual(
    fired.map((f) => f[1]),
    [true, true],
  );
});

test("a disabled switch ignores the pointer and the keyboard", () => {
  const { el, view } = open({ text: "x", enabled: false });

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.equal(el.getAttribute("aria-disabled"), "true");
  assert.equal(el.getAttribute("tabindex"), "-1");

  click(el);
  assert.equal(view.value, false);
  assert.equal(keyDown(el, " "), false);
  assert.equal(view.value, false);
});

test("markup says its value with a string", () => {
  assert.equal(open({ text: "x", value: "true" }).view.value, true);
  assert.equal(open({ text: "x", value: "false" }).view.value, false);
});
