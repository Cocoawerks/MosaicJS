// The ComboBox component, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { ComboBox, Option } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** Mount a combo and hand back its view, root element and select. */
function open(props = {}, children = []) {
  const host = document.createElement("div");
  const view = mount(ComboBox, host, { ...props, children }).view;
  const el = host.childNodes[0];
  return { host, view, el, select: el.childNodes[0] };
}

/** The entries as `<Option>` children, the way markup states them. */
const entries = (...pairs) =>
  pairs.map(([text, value, enabled]) => h(Option, { text, value, enabled }));

// The scope class is left out: it says which module styled the element.
const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

test("draws the ported markup: div[role=listbox] > select + div.chevron", () => {
  const { el, select } = open({}, entries(["Red", "red"]));

  assert.equal(el.tagName, "div");
  assert.equal(el.getAttribute("role"), "listbox");
  assert.deepEqual(classesOf(el), ["v-ComboBox"]);

  assert.equal(select.tagName, "select");
  assert.equal(select.getAttribute("autocomplete"), "off");

  const chevron = el.childNodes[1];
  assert.deepEqual(classesOf(chevron), ["chevron"]);
  assert.equal(
    chevron.childNodes[0].tagName,
    "svg",
    "the icon is drawn, not fetched",
  );
});

test("child Options become the select's entries", () => {
  const { select } = open({}, entries(["Red", "red"], ["Green", "green"]));

  assert.equal(select.childNodes.length, 2);
  assert.equal(select.childNodes[0].tagName, "option");
  assert.equal(select.childNodes[0].getAttribute("value"), "red");
  assert.equal(select.childNodes[0].textContent, "Red");
  assert.equal(select.childNodes[1].getAttribute("value"), "green");
});

test("an Option with no text reads as its value, like a bare <option>", () => {
  const { select } = open({}, [h(Option, { value: "red" })]);
  assert.equal(select.childNodes[0].textContent, "red");
});

test("a disabled Option says so, and an enabled one adds nothing", () => {
  const { select } = open(
    {},
    entries(["Red", "red"], ["Green", "green", false]),
  );

  assert.equal(select.childNodes[0].getAttribute("disabled"), null);
  assert.equal(select.childNodes[1].getAttribute("disabled"), "true");
});

test("entries can be given as data instead of children", () => {
  const { select } = open({ options: ["Red", "Green"] });

  assert.equal(select.childNodes.length, 2);
  assert.equal(select.childNodes[0].getAttribute("value"), "Red");
  assert.equal(select.childNodes[1].textContent, "Green");

  const objects = open({ options: [{ text: "Red", value: "r" }] }).select;
  assert.equal(objects.childNodes[0].getAttribute("value"), "r");
  assert.equal(objects.childNodes[0].textContent, "Red");
});

test("children win over options — they are what the markup states", () => {
  const { select } = open({ options: ["Ignored"] }, entries(["Red", "red"]));

  assert.equal(select.childNodes.length, 1);
  assert.equal(select.childNodes[0].getAttribute("value"), "red");
});

test("the value it was given is the select's", () => {
  const { view, select } = open(
    { value: "green" },
    entries(["Red", "red"], ["Green", "green"]),
  );

  assert.equal(select.value, "green");
  assert.equal(view.value, "green");
});

test("choosing an entry fires the action with the new value", () => {
  const fired = [];
  const { view, select } = open(
    { value: "red", action: (control, value) => fired.push([control, value]) },
    entries(["Red", "red"], ["Green", "green"]),
  );

  // What the user does: the native control changes, then tells us.
  select.value = "green";
  select.dispatchEvent({ type: "change" });

  assert.equal(view.value, "green");
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], view, "the control fires as itself");
  assert.equal(fired[0][1], "green");
});

test("assigning to value moves the select without firing the action", () => {
  const fired = [];
  const { view, select } = open(
    { value: "red", action: () => fired.push(1) },
    entries(["Red", "red"], ["Green", "green"]),
  );

  view.value = "green";
  assert.equal(select.value, "green");
  assert.deepEqual(
    fired,
    [],
    "an owner's own assignment is not a choice by the user",
  );

  // setValue says explicitly whether it counts as one, as in Java.
  view.setValue("red", true);
  assert.deepEqual(fired, [1]);
  assert.equal(select.value, "red");
});

test("setting the value it already has does nothing at all", () => {
  const fired = [];
  const { view } = open(
    { value: "red", action: () => fired.push(1) },
    entries(["Red", "red"]),
  );

  view.setValue("red", true);
  assert.deepEqual(fired, []);
});

test("a disabled combo says so and ignores a change", () => {
  const fired = [];
  const { el, view, select } = open(
    { enabled: false, value: "red", action: () => fired.push(1) },
    entries(["Red", "red"], ["Green", "green"]),
  );

  assert.ok(classesOf(el).includes("is-disabled"));
  assert.equal(el.getAttribute("aria-disabled"), "true");
  assert.equal(select.getAttribute("disabled"), "true");
  assert.equal(
    select.getAttribute("tabindex"),
    "-1",
    "and is out of the tab order",
  );

  select.value = "green";
  select.dispatchEvent({ type: "change" });
  assert.deepEqual(fired, []);
});

test("the control's attributes land on the select, where focus goes", () => {
  const { select } = open(
    { name: "colour", controlId: "colour-field" },
    entries(["Red", "red"]),
  );

  assert.equal(select.getAttribute("name"), "colour");
  assert.equal(select.getAttribute("id"), "colour-field");
  assert.equal(select.getAttribute("tabindex"), "0");
});

test("entries can be replaced after mounting", () => {
  const { view, select } = open({ options: ["Red"] });

  assert.equal(select.childNodes.length, 1);
  view.options = ["Red", "Green", "Blue"];
  assert.equal(view.node.childNodes[0].childNodes.length, 3);
});

test("markup says false with a string, and it means false", () => {
  // A `.mib` file has only text to say it with: `enabled="false"`. A control
  // that read it as truthy would be enabled by an attribute disabling it.
  const { select } = open({}, [
    h(Option, { text: "Red", value: "red" }),
    h(Option, { text: "Gone", value: "gone", enabled: "false" }),
  ]);

  assert.equal(select.childNodes[1].getAttribute("disabled"), "true");

  const combo = open({ enabled: "false" }, [
    h(Option, { text: "Red", value: "red" }),
  ]);
  assert.equal(combo.view.enabled, false);
  assert.equal(combo.select.getAttribute("disabled"), "true");

  // A bare attribute — `<Option enabled>` — is true, and the compiler is what
  // makes it so: it emits the boolean, never an empty string. Only the two
  // words are read as booleans here, so an empty string stays the empty string
  // and a prop that is legitimately "" — a placeholder, a value — survives.
  const bare = open({}, [
    h(Option, { text: "Red", value: "red", enabled: true }),
  ]);
  assert.equal(bare.select.childNodes[0].getAttribute("disabled"), null);
});
