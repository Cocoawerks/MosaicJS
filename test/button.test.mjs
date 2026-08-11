// The Button component, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {mount} = await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const {
  Button,
  Intent,
  ButtonState
} = await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** Mount a button and hand back its view, root element and host. */
function open(props = {}) {
  const host = document.createElement("div");
  const view = mount(Button, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

// The scope class is left out: it says which module styled the element, not
// what the component put there. The compiler appends it last, which is how it
// is picked out now that it is a bare hash.
const classesOf = (el) => el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const press = (el, event = {}) => el.dispatchEvent({ type: "pointerdown", button: 0, ...event });
const release = (el) => el.dispatchEvent({ type: "pointerup" });
const click = (el) => el.dispatchEvent({ type: "click" });

test("draws the ported markup: button > div > span.label", () => {
  const { el } = open({ text: "Save" });

  assert.equal(el.tagName, "button");
  assert.equal(el.getAttribute("type"), "button");
  assert.deepEqual(classesOf(el), ["v-Button", "default", "noIcon"]);

  const layout = el.childNodes[0];
  assert.equal(layout.tagName, "div");
  assert.equal(layout.childNodes[0].tagName, "span");
  assert.deepEqual(classesOf(layout.childNodes[0]), ["label"]);
  assert.equal(layout.childNodes[0].textContent, "Save");
});

test("intent becomes a class, as Intent.toString() does in Java", () => {
  const { el, view } = open({ text: "Delete", intent: Intent.DANGER });
  assert.ok(classesOf(el).includes("danger"));

  view.intent = Intent.PRIMARY;
  assert.ok(classesOf(el).includes("primary"));
  assert.equal(classesOf(el).includes("danger"), false, "old intent removed");
});

test("a momentary press latches is-active only while held", () => {
  const { el, view } = open({ text: "Go" });

  press(el);
  assert.ok(classesOf(el).includes("is-active"));
  assert.equal(view.buttonState, ButtonState.ON);

  release(el);
  assert.equal(classesOf(el).includes("is-active"), false);
  assert.equal(view.buttonState, ButtonState.OFF);
});

test("pointerleave and blur clear a momentary press", () => {
  for (const type of ["pointerleave", "blur"]) {
    const { el, view } = open({ text: "Go" });
    press(el);
    el.dispatchEvent({ type });
    assert.equal(view.buttonState, ButtonState.OFF, type);
  }
});

test("a toggle latches and reports aria-pressed", () => {
  const { el, view } = open({ text: "Bold", toggle: true });
  assert.ok(classesOf(el).includes("toggle"));
  assert.equal(el.getAttribute("aria-pressed"), "false");

  press(el);
  assert.ok(classesOf(el).includes("is-active"));
  assert.equal(el.getAttribute("aria-pressed"), "true");

  release(el); // a toggle stays on
  assert.ok(classesOf(el).includes("is-active"));

  press(el);
  assert.equal(classesOf(el).includes("is-active"), false);
  assert.equal(view.on, false);
});

test("the action fires once per activation, and never twice for a toggle", () => {
  let fired = 0;
  const { el } = open({ text: "Go", action: () => (fired += 1) });
  press(el);
  release(el);
  click(el);
  assert.equal(fired, 1, "momentary: fires on click");

  fired = 0;
  const toggle = open({ text: "Bold", toggle: true, action: () => (fired += 1) });
  press(toggle.el);
  release(toggle.el);
  click(toggle.el);
  assert.equal(fired, 1, "toggle: fires on the state change only");
});

test("Enter and Space activate, other keys do not", () => {
  let fired = 0;
  const { el, view } = open({ text: "Go", action: () => (fired += 1) });

  el.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(view.buttonState, ButtonState.ON);
  el.dispatchEvent({ type: "keyup", key: "Enter" });
  assert.equal(view.buttonState, ButtonState.OFF);

  el.dispatchEvent({ type: "keydown", key: "a" });
  assert.equal(view.buttonState, ButtonState.OFF, "ignored key");
  assert.equal(fired, 0, "keydown alone does not fire for a momentary button");
});

test("a disabled button neither activates nor fires", () => {
  let fired = 0;
  const { el, view } = open({ text: "Go", enabled: false, action: () => (fired += 1) });

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.equal(el.getAttribute("aria-disabled"), "true");
  assert.equal(el.getAttribute("tabindex"), "-1");

  press(el);
  click(el);
  el.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(fired, 0);
  assert.equal(view.buttonState, ButtonState.OFF);

  view.enabled = true;
  assert.equal(classesOf(el).includes("is-disabled"), false);
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.equal(el.getAttribute("aria-disabled"), null);
  click(el);
  assert.equal(fired, 1);
});

test("an icon replaces noIcon, and iconOnly drops the label", () => {
  const { el, view } = open({ text: "Save", icon: "fa-save" });
  assert.equal(classesOf(el).includes("noIcon"), false);

  const icon = el.childNodes[0].childNodes[0];
  assert.deepEqual(classesOf(icon), ["icon", "fa-save"]);
  assert.deepEqual(classesOf(el.childNodes[0].childNodes[1]), ["label"]);

  view.iconOnly = true;
  assert.ok(classesOf(el).includes("iconOnly"));
  assert.equal(el.childNodes[0].childNodes.length, 1, "label removed");
});

test("an image icon is painted as a background, like setIconBase64()", () => {
  const { el } = open({ iconImage: "data:image/png;base64,AAA" });
  const icon = el.childNodes[0].childNodes[0];
  assert.equal(icon.tagName, "i");
  assert.equal(icon.style.backgroundImage, "url(data:image/png;base64,AAA)");
});

test("tooltip is the native title, and clears when unset", () => {
  const { el, view } = open({ text: "Go", tooltip: "Send it" });
  assert.equal(el.getAttribute("title"), "Send it");

  view.tooltip = null;
  assert.equal(el.getAttribute("title"), null);
});

test("setters patch the existing node rather than replacing it", () => {
  const { el, view } = open({ text: "One" });
  view.text = "Two";

  assert.equal(view.node, el, "same element");
  assert.equal(el.childNodes[0].childNodes[0].textContent, "Two");
});
