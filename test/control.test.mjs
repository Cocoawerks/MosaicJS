// Control, the focusable/enable-able superclass ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { Control } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** A minimal control: everything below comes from the base class. */
class Widget extends Control {
  draw() {
    return h(
      "button",
      { ...this.controlProps(), class: this.controlClasses().join(" ") },
      "x",
    );
  }
}

function open(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(Widget, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

test("an enabled control is in the tab order", () => {
  const { el } = open();
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.equal(el.getAttribute("aria-disabled"), null);
  assert.equal(el.getAttribute("class"), "");
});

test("disabling marks, un-tabs and un-focuses the control", () => {
  const { el, view } = open();
  view.setFocus(true);
  assert.equal(view.focused, true);

  view.enabled = false;
  assert.equal(view.enabled, false);
  assert.equal(el.getAttribute("tabindex"), "-1");
  assert.equal(el.getAttribute("aria-disabled"), "true");
  assert.equal(el.getAttribute("class"), "is-disabled");
  assert.equal(view.focused, false, "focus was dropped");

  view.enabled = true;
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.equal(el.getAttribute("aria-disabled"), null);
});

test("enabled can also come from a prop", () => {
  const { el, view } = open({ enabled: false });
  assert.equal(view.enabled, false);
  assert.equal(el.getAttribute("tabindex"), "-1");
});

test("tabIndex can be set explicitly", () => {
  const { el, view } = open();
  view.tabIndex = 3;
  assert.equal(el.getAttribute("tabindex"), "3");
});

test("setFocus moves focus in and out", () => {
  const { el, view } = open();
  view.setFocus(true);
  assert.equal(document.activeElement, el);
  view.setFocus(false);
  assert.notEqual(document.activeElement, el);
});

test("identity settings reach the element", () => {
  const { el, view } = open({ name: "save", controlId: "save-btn" });
  assert.equal(el.getAttribute("name"), "save");
  assert.equal(el.getAttribute("id"), "save-btn");

  view.name = "store";
  assert.equal(el.getAttribute("name"), "store", "setting repaints");
});

test("fireAction calls the action the owner bound", () => {
  let received = null;
  const { view } = open({ action: (control) => (received = control) });
  view.fireAction();
  assert.equal(received, view, "the control passes itself");
});

test("fireAction is a no-op when no action is bound", () => {
  const { view } = open();
  assert.doesNotThrow(() => view.fireAction());
});

test("focus and blur remain available as event handler names", () => {
  // Control deliberately avoids methods named focus/blur, so a subclass can
  // use them as handlers without recursing into the imperative API.
  const seen = [];
  class Focusable extends Control {
    focus() {
      seen.push("focus");
    }
    blur() {
      seen.push("blur");
    }
    draw() {
      return h("button", this.controlProps(), "x");
    }
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Focusable, host, {});

  host.childNodes[0].dispatchEvent({ type: "focus" });
  host.childNodes[0].dispatchEvent({ type: "blur" });
  assert.deepEqual(seen, ["focus", "blur"]);
});
