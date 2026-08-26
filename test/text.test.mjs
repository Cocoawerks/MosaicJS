// TextBase, TextField and SearchField, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { TextField, TextFieldType, SearchField } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** Mount a field and hand back its view, box element and input. */
function open(Type, props = {}) {
  const host = document.createElement("div");
  const view = mount(Type, host, props).view;
  const el = host.childNodes[0];
  return { host, view, el, input: el.childNodes[0].childNodes[1] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

/** What the user does: type into the input, then let it say so. */
function type(view, input, text) {
  input.value = text;
  input.dispatchEvent({ type: "input" });
}

// --- TextField --------------------------------------------------------------

test("draws the ported markup: div.v-Text > div > i + input + i", () => {
  const { el, input } = open(TextField, { placeholder: "Name" });

  assert.equal(el.getAttribute("role"), "textbox");
  assert.deepEqual(classesOf(el), ["v-Text"]);

  const row = el.childNodes[0];
  assert.equal(row.tagName, "div");
  assert.ok(classesOf(row.childNodes[0]).includes("prefix"));
  assert.equal(input.tagName, "input");
  assert.deepEqual(classesOf(input), ["v-Text-input"]);
  assert.ok(classesOf(row.childNodes[2]).includes("suffix"));

  assert.equal(input.getAttribute("placeholder"), "Name");
  assert.equal(
    input.getAttribute("spellcheck"),
    "false",
    "off",
  );
  assert.equal(input.getAttribute("type"), "text");
});

test("the type is the input's, and an icon class rides on the slot", () => {
  const { el, input } = open(TextField, {
    type: TextFieldType.PASSWORD,
    prefixIcon: "fa-user",
    suffixIcon: "fa-eye",
  });

  assert.equal(input.getAttribute("type"), "password");
  assert.ok(classesOf(el.childNodes[0].childNodes[0]).includes("fa-user"));
  assert.ok(classesOf(el.childNodes[0].childNodes[2]).includes("fa-eye"));
});

test("typing is reported to the change action, with the new value", () => {
  const changed = [];
  const { view, input } = open(TextField, {
    changeAction: (control, value) => changed.push([control, value]),
  });

  type(view, input, "Mos");
  assert.equal(view.value, "Mos");
  assert.equal(changed.length, 1);
  assert.equal(changed[0][0], view, "the control reports as itself");
  assert.equal(changed[0][1], "Mos");
});

test("a field that is not continuous waits until the input settles", () => {
  const changed = [];
  const { view, input } = open(TextField, {
    continuous: false,
    changeAction: (control, value) => changed.push(value),
  });

  type(view, input, "Mos");
  assert.deepEqual(changed, [], "not while typing");

  input.dispatchEvent({ type: "change" });
  assert.deepEqual(changed, ["Mos"]);
});

test("Enter is the action: the user saying they are done", () => {
  const fired = [];
  const changed = [];
  const { view, input } = open(TextField, {
    action: (control, value) => fired.push(value),
    changeAction: (control, value) => changed.push(value),
  });

  type(view, input, "Mosaic");
  input.dispatchEvent({ type: "keypress", key: "Enter" });

  assert.deepEqual(fired, ["Mosaic"]);
  assert.deepEqual(
    changed,
    ["Mosaic", "Mosaic"],
    "and the value is reported with it",
  );

  input.dispatchEvent({ type: "keypress", key: "a" });
  assert.deepEqual(fired, ["Mosaic"], "another key is not the action");
});

test("assigning to value moves the input without reporting a change", () => {
  const changed = [];
  const { view, input } = open(TextField, {
    changeAction: () => changed.push(1),
  });

  view.value = "set from outside";
  assert.equal(input.value, "set from outside");
  assert.deepEqual(changed, []);

  view.setValue("said so", true);
  assert.deepEqual(changed, [1]);
});

test("focus is the input's, and the box says when it has it", () => {
  const { el, view, input } = open(TextField, {});

  input.dispatchEvent({ type: "focus" });
  assert.ok(classesOf(el).includes("is-focused"));
  assert.equal(
    view.focused,
    false,
    "the shim does not move focus on a bare event",
  );

  input.dispatchEvent({ type: "blur" });
  assert.equal(classesOf(el).includes("is-focused"), false);
});

test("a disabled field wears no focus ring", () => {
  // Disabling is itself a setFocus(false), which is how the ring came to be lit
  // by the one thing that should put it out.
  const { el, view } = open(TextField, {});
  view.enabled = false;
  assert.equal(
    classesOf(el).includes("is-focused"),
    false,
    "disabling must not light the ring",
  );

  // A field that had the ring loses it when it is disabled.
  const second = open(TextField, {});
  second.input.dispatchEvent({ type: "focus" });
  assert.ok(classesOf(second.el).includes("is-focused"));
  second.view.enabled = false;
  assert.equal(classesOf(second.el).includes("is-focused"), false);

  // And one disabled by a prop, which never passes through the setter.
  const third = open(TextField, {});
  third.input.dispatchEvent({ type: "focus" });
  assert.ok(classesOf(third.el).includes("is-focused"));
  third.view.props = { ...third.view.props, enabled: false };
  third.view.needsDisplay();
  assert.equal(
    classesOf(third.host.childNodes[0]).includes("is-focused"),
    false,
  );
});

test("a disabled field disables the input it wraps", () => {
  const changed = [];
  const { el, view, input } = open(TextField, {
    enabled: false,
    changeAction: () => changed.push(1),
  });

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.equal(input.getAttribute("disabled"), "disabled");
  assert.equal(input.getAttribute("tabindex"), "-1");

  type(view, input, "nope");
  assert.deepEqual(changed, [], "and reports nothing");
});

test("required and autocomplete land on the input", () => {
  const { input } = open(TextField, { required: true, autocomplete: true });
  assert.equal(input.getAttribute("required"), "required");
  assert.equal(input.getAttribute("autocomplete"), "on");

  const off = open(TextField, {}).input;
  assert.equal(off.getAttribute("required"), null);
  assert.equal(off.getAttribute("autocomplete"), "off");
});

// --- SearchField ------------------------------------------------------------

test("a search field draws its magnifier and its clear button", () => {
  const { el, input } = open(SearchField, {});

  assert.equal(el.getAttribute("role"), "searchbox");
  assert.ok(classesOf(el).includes("v-Search"));
  assert.ok(classesOf(el).includes("v-Text"), "and is a text field besides");

  const row = el.childNodes[0];
  assert.ok(classesOf(row.childNodes[0]).includes("search"));
  assert.equal(
    row.childNodes[0].childNodes[0].tagName,
    "svg",
    "the icon is inlined",
  );
  assert.equal(input.getAttribute("placeholder"), "Search");

  const clear = row.childNodes[2];
  assert.equal(clear.tagName, "button");
  assert.ok(classesOf(clear).includes("Search-reset"));
  assert.equal(clear.childNodes[0].childNodes[0].tagName, "svg");
});

test("there is nothing to clear while the field is empty", () => {
  const { el, view, input } = open(SearchField, {});
  const clear = () => view.node.childNodes[0].childNodes[2];

  assert.equal(clear().getAttribute("aria-hidden"), "true");
  assert.equal(clear().getAttribute("tabindex"), "-1");

  type(view, input, "mosaic");
  assert.equal(clear().getAttribute("aria-hidden"), "false");
  assert.equal(clear().getAttribute("tabindex"), "0");
});

test("clearing empties the field, reports the change and says it was cancelled", () => {
  const changed = [];
  const cancelled = [];
  const { view, input } = open(SearchField, {
    changeAction: (control, value) => changed.push(value),
    cancelAction: (control) => cancelled.push(control),
  });

  type(view, input, "mosaic");
  view.node.childNodes[0].childNodes[2].dispatchEvent({ type: "click" });

  assert.equal(view.value, "");
  assert.deepEqual(changed, ["mosaic", ""]);
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0], view, "the field reports as itself");
});
