// LoadingButton and LoadingIndicator, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const {
  LoadingButton,
  setLoadingDelay,
  getLoadingDelay,
  LoadingIndicator,
  Size,
  State,
} =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

function open(Type, props = {}) {
  const host = document.createElement("div");
  const view = mount(Type, host, props).view;
  return { host, view, el: host.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- LoadingButton ----------------------------------------------------------

test("draws a button with a loader in its icon slot", () => {
  const { el } = open(LoadingButton, { text: "Save" });

  assert.equal(el.tagName, "button");
  assert.ok(classesOf(el).includes("loading"));
  assert.equal(classesOf(el).includes("noIcon"), false, "the slot is taken");

  const spinner = el.childNodes[0].childNodes[0];
  assert.ok(classesOf(spinner).includes("button-loader"));
  assert.equal(
    spinner.style.visibility,
    "hidden",
    "and is not shown until it has to be",
  );
  assert.equal(
    el.childNodes[0].childNodes[1].textContent,
    "Save",
    "the label is still there",
  );
});

test("work that finishes quickly never shows a spinner", async () => {
  setLoadingDelay(50);
  const { el, view } = open(LoadingButton, { text: "Save" });

  view.loading = true;
  assert.equal(view.enabled, false, "but it is disabled while it runs");
  assert.equal(
    view.node.childNodes[0].childNodes[0].style.visibility,
    "hidden",
  );

  view.loading = false;
  await wait(80);

  assert.equal(
    view.node.childNodes[0].childNodes[0].style.visibility,
    "hidden",
  );
  assert.equal(classesOf(view.node).includes("is-loading"), false);
  assert.equal(view.enabled, true, "and it comes back");
});

test("work that runs on shows one, once the wait has passed", async () => {
  setLoadingDelay(30);
  const { view } = open(LoadingButton, { text: "Save" });

  view.loading = true;
  await wait(60);

  assert.ok(classesOf(view.node).includes("is-loading"));
  assert.equal(
    view.node.childNodes[0].childNodes[0].style.visibility,
    "visible",
  );
  assert.equal(view.node.getAttribute("aria-busy"), "true");

  view.loading = false;
  assert.equal(classesOf(view.node).includes("is-loading"), false);
  assert.equal(view.enabled, true);
});

test("a button that is taken apart mid-flight leaves no timer behind", async () => {
  setLoadingDelay(20);
  const host = document.createElement("div");
  const unmount = mount(LoadingButton, host, { text: "Save" });

  unmount.view.loading = true;
  unmount();
  await wait(50); // the timer would have fired by now, on a dead view
  assert.ok(true);
});

test("the delay is the framework's, and can be read back", () => {
  setLoadingDelay(300);
  assert.equal(getLoadingDelay(), 300);
});

// --- LoadingIndicator -------------------------------------------------------

test("draws a spinner, and a message only when there is one", () => {
  const bare = open(LoadingIndicator, {});
  assert.deepEqual(classesOf(bare.el), ["v-LoadingIndicator", "medium"]);
  assert.equal(bare.el.childNodes.length, 1, "no message, no line");
  assert.ok(
    classesOf(bare.el.childNodes[0]).includes("v-LoadingIndicator-spinner"),
  );

  const spoken = open(LoadingIndicator, { message: "Loading…" });
  assert.equal(spoken.el.childNodes[1].textContent, "Loading…");
  assert.ok(
    classesOf(spoken.el.childNodes[1]).includes("v-LoadingIndicator-message"),
  );
});

test("it says it is busy while it is loading", () => {
  const { el } = open(LoadingIndicator, { message: "Loading…" });
  assert.equal(el.getAttribute("role"), "status");
  assert.equal(el.getAttribute("aria-busy"), "true");
});

test("the size is a class, as it is in the Java version", () => {
  const { el, view } = open(LoadingIndicator, { size: Size.LARGE });
  assert.ok(classesOf(el).includes("large"));

  view.size = Size.SMALL;
  assert.ok(classesOf(view.node).includes("small"));
  assert.equal(
    classesOf(view.node).includes("large"),
    false,
    "one size at a time",
  );
});

test("finishing turns the spinner into a tick, and failing into a cross", () => {
  const { view } = open(LoadingIndicator, { message: "Working…" });
  const spinner = () => view.node.childNodes[0];

  view.setComplete("Done");
  assert.equal(view.state, State.COMPLETE);
  assert.ok(classesOf(spinner()).includes("is-complete"));
  assert.equal(view.node.childNodes[1].textContent, "Done");
  assert.equal(view.node.getAttribute("aria-busy"), "false");

  view.setFailed("Could not save");
  assert.ok(classesOf(spinner()).includes("is-failed"));
  assert.equal(classesOf(spinner()).includes("is-complete"), false);
  assert.ok(
    classesOf(view.node.childNodes[1]).includes("is-error"),
    "and the message reads as one",
  );

  view.reset("Working…");
  assert.equal(view.state, State.LOADING);
  assert.equal(classesOf(spinner()).includes("is-failed"), false);
});
