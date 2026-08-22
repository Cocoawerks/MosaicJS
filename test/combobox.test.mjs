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

// --- popup -------------------------------------------------------------------
//
// `popup` trades the platform's list for one of the framework's own: a macOS
// popup button rather than a combo box. The value, the action and the entries
// are the same either way — what changes is what opens.

/** The panel of the menu this popup put up. Asked of the view rather than
 * looked for in the document: the tests share one, and a menu another test
 * left up would answer first. */
const menuOf = (view) => view.menu?.node;

/** Every element under `el`, since the shim matches one compound at a time. */
const allUnder = (el, out = []) => {
  for (const child of el.childNodes ?? []) {
    if (child.tagName) out.push(child);
    allUnder(child, out);
  }
  return out;
};

const press = (el) =>
  el.dispatchEvent({
    type: "pointerdown",
    button: 0,
    preventDefault: () => {},
  });

test("a popup draws no native list, and reads what is chosen", () => {
  const { el } = open(
    { popup: "true", value: "green" },
    entries(["Red", "red"], ["Green", "green"]),
  );

  assert.equal(el.querySelectorAll("select").length, 0, "no select under it");
  assert.equal(el.getAttribute("role"), "button");
  assert.equal(el.getAttribute("aria-haspopup"), "listbox");
  assert.equal(el.getAttribute("aria-expanded"), "false");
  assert.ok(classesOf(el).includes("popup"));
  assert.equal(el.querySelectorAll("span")[0].textContent, "Green");
});

test("and the chevron says the list may go either way", () => {
  // Two paths: a chevron up over a chevron down, which is what a control that
  // opens a list *over* itself wears.
  const { el } = open({ popup: "true" }, entries(["Red", "red"]));

  assert.equal(
    allUnder(el).filter((n) => n.tagName === "path").length,
    2,
    "one up, one down",
  );
});

test("pressing it puts up a menu of the entries, on the one chosen", () => {
  const { el, view } = open(
    { popup: "true", value: "green" },
    entries(["Red", "red"], ["Green", "green"], ["Gone", "gone", "false"]),
  );

  press(el);

  const menu = menuOf(view);
  assert.ok(menu, "the menu is up");
  const items = menu.querySelectorAll("li");
  assert.deepEqual(
    items.map((li) => li.textContent.trim()),
    ["Red", "Green", "Gone"],
  );
  // Opened on what is already chosen, so the arrows step from there.
  assert.equal(menu.__ibView.activeValue, "green");
  // And ticked, as a popup marks the entry it is on.
  const ticked = items.filter(
    (li) =>
      li
        .querySelectorAll(".icon")
        .filter((i) => !i.classList.contains("submenu-indicator")).length > 0,
  );
  assert.deepEqual(
    ticked.map((li) => li.textContent.trim()),
    ["Green"],
  );
  // An entry that cannot be chosen says so, as an <option> would.
  assert.equal(items[2].getAttribute("aria-disabled"), "true");
  assert.equal(view.open, true);
});

test("choosing from it sets the value and says so once", () => {
  const said = [];
  const { el, view } = open(
    {
      popup: "true",
      value: "red",
      action: (combo, value) => said.push(value),
    },
    entries(["Red", "red"], ["Blue", "blue"]),
  );

  press(el);
  const blue = menuOf(view)
    .querySelectorAll("li")
    .find((li) => li.getAttribute("data-item") === "blue");
  blue.dispatchEvent({ type: "click", stopPropagation: () => {} });

  assert.equal(view.value, "blue");
  assert.deepEqual(said, ["blue"]);
  assert.equal(view.open, false, "and the menu goes with the choosing");
  assert.equal(
    view.node.querySelectorAll("span")[0].textContent,
    "Blue",
    "the trigger reads what is now chosen",
  );
});

test("a disabled popup opens nothing", () => {
  const { el, view } = open(
    { popup: "true", enabled: "false" },
    entries(["Red", "red"]),
  );

  press(el);
  assert.equal(view.open, false);
  assert.equal(el.getAttribute("tabindex"), null, "and is not a tab stop");
});

test("the keys that open a list open it too", () => {
  const { el, view } = open(
    { popup: "true", value: "red" },
    entries(["Red", "red"], ["Blue", "blue"]),
  );

  el.dispatchEvent({
    type: "keydown",
    key: "ArrowDown",
    preventDefault: () => {},
  });
  assert.equal(view.open, true);
});

test("pressing a popup gives it the keyboard, and closing gives it back", () => {
  // A press focuses what it lands on, and the popup refuses that default so
  // the press can open the menu instead — so the trigger has to take the
  // keyboard itself. Without it the menu hands focus back on closing to
  // whatever held it before the press, somewhere else on the page entirely.
  const { el, view } = open(
    { popup: "true", value: "red" },
    entries(["Red", "red"], ["Blue", "blue"]),
  );
  document.body.appendChild(el);

  press(el);
  // The menu has it while it is up — that is what the arrows are driving.
  assert.equal(document.activeElement, view.menu.node);

  view.menu.hide();
  assert.equal(document.activeElement, el, "and the trigger has it again");
});

test("a popup is a tab stop, and a disabled one is not", () => {
  // What the ring is drawn against: the theme rings the root on
  // `:focus-visible`, and a control nothing can focus never gets one.
  const on = open({ popup: "true" }, entries(["Red", "red"]));
  assert.equal(on.el.getAttribute("tabindex"), "0");

  const off = open(
    { popup: "true", enabled: "false" },
    entries(["Red", "red"]),
  );
  assert.equal(off.el.getAttribute("tabindex"), null);
});
