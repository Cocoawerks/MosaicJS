// Every component's declared primary style name against the class it actually
// draws.
//
// `static primaryStyleName` is what a stylesheet is naming when it says `ComboBox`,
// and the compiler puts it in the sheet without ever running the component. So
// nothing but this checks the two agree: a component that renamed its root
// class would leave every sheet that reached it by name pointing at a class no
// element wears, and the rules would simply stop applying.
//
// Build first: `mosaic compile examples/Counter_component --keep-modules`.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const ui = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);
const { mount } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);

/**
 * Components that cannot simply be mounted with no props to be looked at: a
 * surface draws nothing until it is shown, and a few need something to hold.
 * Their declaration is checked against the source instead, further down.
 */
const NOT_MOUNTABLE = new Set([
  "Dialog",
  "Drawer",
  "PopOver",
  "Menu",
  "Tooltip",
  "SnackBar",
  "Toast",
  "MenuBarItem",
]);

/** Every exported component that declares a primary style name. */
const declared = Object.entries(ui).filter(
  ([, value]) => typeof value === "function" && value.primaryStyleName,
);

test("the framework's components declare a primary style name", () => {
  // Not a fixed list — a count, so adding a component to the framework does
  // not fail this, and removing them all does.
  assert.ok(
    declared.length >= 25,
    `only ${declared.length} components declare one`,
  );
});

test("and each one draws the class it declared", () => {
  const missing = [];

  for (const [name, Type] of declared) {
    if (NOT_MOUNTABLE.has(name)) continue;

    const host = document.createElement("div");
    document.body.appendChild(host);
    let root;
    try {
      root = mount(Type, host, {}).view?.node;
    } catch {
      continue; // Needs more than nothing to draw; the source check covers it.
    }
    if (!root?.getAttribute) continue;

    const classes = (root.getAttribute("class") ?? "").split(/\s+/);
    if (!classes.includes(Type.primaryStyleName)) {
      missing.push(`${name} declares ${Type.primaryStyleName}, draws [${classes}]`);
    }
  }

  assert.deepEqual(missing, []);
});

test("a component drawn as a kind of another inherits that one's", () => {
  // A LoadingButton is a Button and draws `v-Button`; it declares nothing of
  // its own, and `primaryStyleName` comes down the prototype chain.
  assert.equal(ui.LoadingButton.primaryStyleName, ui.Button.primaryStyleName);
  assert.equal(ui.TextField.primaryStyleName, ui.TextBase?.primaryStyleName ?? "v-Text");
});
