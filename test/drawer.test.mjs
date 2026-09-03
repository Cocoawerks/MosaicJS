// Drawer, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
// There is no layout here, so how far the panel slides is not what these check
// — that is checked in the browser, by the KitchenSink's own page. What they
// check is what it does: what puts it out and what puts it away, that the page
// is pushed aside and given its room back, and what it says while it moves.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const { Drawer, Dialog } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/** Mount a drawer with something in it. */
function make(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(Drawer, host, {
    title: "Filters",
    ...props,
    children: [h("p", {}, "what it holds")],
  }).view;

  return { host, view, el: host.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

const pushed = () => document.body.style.paddingRight;

/** Let the frame the slide is started on go by, and the settle after it. */
const slid = () => new Promise((resolve) => setTimeout(resolve, 300));
const aFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

// Each test starts with the page unpushed, whatever the last one left.
const reset = () => {
  document.body.style.paddingRight = "";
  document.body.style.transition = "";
};

// --- what it draws -----------------------------------------------------------

test("draws the ported markup: a header with a title and a close button", () => {
  reset();
  const { el } = make();

  assert.deepEqual(classesOf(el), ["v-Drawer"]);
  assert.equal(el.getAttribute("role"), "complementary");

  const [header, body] = el.childNodes;
  assert.ok(classesOf(header).includes("header"));
  assert.equal(header.childNodes[0].textContent, "Filters");
  assert.ok(classesOf(header.childNodes[1]).includes("close"));

  assert.ok(classesOf(body).includes("body"));
  assert.equal(body.childNodes[0].textContent, "what it holds");
});

test("a drawer that is away is out of the tab order and hidden from a reader", () => {
  reset();
  const { el, view } = make();

  assert.equal(el.getAttribute("aria-hidden"), "true");
  assert.equal(el.getAttribute("inert"), "");

  view.show();
  assert.equal(el.getAttribute("aria-hidden"), null);
  assert.equal(el.getAttribute("inert"), null);
  assert.ok(classesOf(el).includes("is-open"));
});

// --- coming and going --------------------------------------------------------

test("showing it slides it out, and closing puts it back", () => {
  reset();
  const { el, view } = make();

  view.show();
  assert.equal(view.open, true);
  assert.ok(classesOf(el).includes("is-open"));

  view.close();
  assert.equal(view.open, false);
  assert.equal(classesOf(el).includes("is-open"), false);
});

test("toggle does whichever it is not doing", () => {
  reset();
  const { view } = make();

  view.toggle();
  assert.equal(view.open, true);
  view.toggle();
  assert.equal(view.open, false);
});

test("visible says the same thing, and can be assigned", () => {
  reset();
  const { view } = make();

  view.visible = true;
  assert.equal(view.visible, true);
  view.visible = false;
  assert.equal(view.visible, false);
});

test("showing twice does nothing the second time", async () => {
  reset();
  const seen = [];
  const { view } = make({ onOpen: () => seen.push("open") });

  view.show();
  view.show();
  await slid();
  assert.deepEqual(seen, ["open"]);
});

test("it says it is open once it has finished sliding, not before", async () => {
  reset();
  const seen = [];
  const { view } = make({ onOpen: () => seen.push("open") });

  view.show();
  assert.deepEqual(seen, [], "still on its way");

  await slid();
  assert.deepEqual(seen, ["open"]);
});

test("and says it is closed at once, since nothing waits on a panel going", async () => {
  reset();
  const seen = [];
  const { view } = make({ onClose: () => seen.push("close") });

  view.show();
  await slid();
  view.close();
  assert.deepEqual(seen, ["close"]);
});

test("open and close are their own events; the general action stays silent", async () => {
  reset();
  const seen = [];
  const { view } = make({
    openAction: () => seen.push("open"),
    closeAction: () => seen.push("close"),
    action: () => seen.push("action"),
  });

  view.show();
  await slid();
  assert.deepEqual(seen, ["open"]);

  view.close();
  assert.deepEqual(seen, ["open", "close"]);
});

test("closing one that is already away reports nothing", () => {
  reset();
  const seen = [];
  const { view } = make({ onClose: () => seen.push("close") });

  view.close();
  assert.deepEqual(seen, []);
});

// --- pushing the page --------------------------------------------------------

test("it pushes the page aside rather than covering it", async () => {
  reset();
  const { view } = make();

  assert.equal(pushed(), "");
  view.show();
  await aFrame();
  assert.match(pushed(), /^\d+px$/, "the page was given padding to make room");
  assert.match(document.body.style.transition, /padding-right/);
});

test("and gives the room back when it goes", async () => {
  reset();
  const { view } = make();

  view.show();
  await aFrame();
  view.close();
  assert.equal(pushed(), "0px");
});

test("a drawer told not to push slides over the page instead", async () => {
  reset();
  const { view } = make({ push: "false" });

  view.show();
  await aFrame();
  assert.equal(pushed(), "", "the page was left alone");
});

test("a drawer taken off the page while out gives the room back", async () => {
  reset();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const unmount = mount(Drawer, host, { children: [h("p", {}, "x")] });

  unmount.view.show();
  await aFrame();
  unmount();
  assert.equal(pushed(), "0px");
});

// --- what it listens to ------------------------------------------------------

test("the close button puts it away", async () => {
  reset();
  const { el, view } = make();
  view.show();
  await slid();

  el.childNodes[0].childNodes[1].dispatchEvent({ type: "click" });
  assert.equal(view.open, false);
});

test("Escape inside it puts it away, and goes no further", async () => {
  reset();
  const { el, view } = make();
  view.show();
  await slid();

  let travelled = false;
  el.parentNode.addEventListener("keydown", () => (travelled = true));

  // No stopPropagation of our own: the shim installs one that records whether
  // it was called, and passing a stub would answer the question for it.
  el.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(view.open, false);
  assert.equal(travelled, false, "the page behind keeps its own Escape");
});

test("another key does nothing", async () => {
  reset();
  const { el, view } = make();
  view.show();
  await slid();

  el.dispatchEvent({ type: "keydown", key: "a" });
  assert.equal(view.open, true);
});

test("a dialog opening over the page takes the drawer with it", async () => {
  reset();
  const { view } = make();
  view.show();
  await slid();

  // A drawer is not modal, so a dialog would sit over a live panel: it goes.
  const dialogHost = document.createElement("div");
  document.body.appendChild(dialogHost);
  const dialog = mount(Dialog, dialogHost, {
    title: "Over it",
    children: [h("p", {}, "content")],
  }).view;
  dialog.show();
  await slid();

  assert.equal(view.open, false);
  dialog.forceClose();
});

test("and a drawer that has gone is no longer listening for one", async () => {
  reset();
  const { view } = make();
  view.show();
  await slid();
  view.close();

  const dialogHost = document.createElement("div");
  document.body.appendChild(dialogHost);
  const dialog = mount(Dialog, dialogHost, {
    title: "Over it",
    children: [h("p", {}, "content")],
  }).view;

  view.show();
  await slid();
  // The drawer went up after the listener was taken off and put back; a dialog
  // opening now still closes it, which is what says the listener was restored.
  dialog.show();
  await slid();
  assert.equal(view.open, false);
  dialog.forceClose();
});

// --- keeping what it pushes in step ------------------------------------------

test("it says so on every frame while it moves, so what it pushes can follow", async () => {
  reset();
  let frames = 0;
  const { view } = make({ onLayoutFrame: () => (frames += 1) });

  view.show();
  await slid();
  assert.ok(frames > 1, `told more than once while sliding (${frames})`);

  const afterOpening = frames;
  await slid();
  assert.equal(frames, afterOpening, "and stops once it has stopped moving");
});

test("the close button takes the keyboard once the panel is out", async () => {
  reset();
  const { el, view } = make();

  const close = el.childNodes[0].childNodes[1];
  assert.notEqual(document.activeElement, close, "not before it is shown");

  view.show();
  await slid();
  assert.equal(document.activeElement, close);
});

test("which is what makes Escape reach it at all", async () => {
  // A drawer is not modal and hears Escape only when the key was pressed
  // inside it. Nothing focused in the panel would mean no way to dismiss it
  // from the keyboard.
  reset();
  const { view } = make();
  view.show();
  await slid();

  document.activeElement.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(view.open, false);
});

test("a drawer closed before it is out asks for no focus", async () => {
  reset();
  const { el, view } = make();
  const close = el.childNodes[0].childNodes[1];

  view.show();
  view.close();
  await slid();

  assert.notEqual(document.activeElement, close);
});

// --- handing the keyboard back -----------------------------------------------
// A modal dialog gets this from the platform: `showModal()` remembers what was
// focused and returns to it on close. A drawer is an ordinary element, so it
// keeps the place itself.

test("closing gives the keyboard back to what had it", async () => {
  reset();
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();

  const { view, el } = make();
  view.show();
  await slid();
  assert.equal(
    document.activeElement,
    el.childNodes[0].childNodes[1],
    "the close button has it while the panel is out",
  );

  view.close();
  assert.equal(document.activeElement, opener);
});

test("but not if the keyboard was moved out into the page meanwhile", async () => {
  // Focus put somewhere else on purpose is not the panel's to take back.
  reset();
  const opener = document.createElement("button");
  const elsewhere = document.createElement("input");
  document.body.appendChild(opener);
  document.body.appendChild(elsewhere);
  opener.focus();

  const { view } = make();
  view.show();
  await slid();

  elsewhere.focus();
  view.close();
  assert.equal(document.activeElement, elsewhere);
});

test("and not to something that has since left the page", async () => {
  reset();
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();

  const { view } = make();
  view.show();
  await slid();

  opener.remove();
  view.close();
  // Nothing to give it back to, and nothing thrown for the want of it.
  assert.notEqual(document.activeElement, opener);
});

test("a drawer opened with nothing focused hands nothing back", async () => {
  reset();
  document.activeElement?.blur?.();

  const { view } = make();
  view.show();
  await slid();
  view.close();

  // The close button had it and lost it with the panel; nothing was restored
  // over the top of that.
  assert.equal(view.returnFocusTo, null);
});

test("what it hands back is what had the keyboard each time it opened", async () => {
  reset();
  const first = document.createElement("button");
  const second = document.createElement("button");
  document.body.appendChild(first);
  document.body.appendChild(second);

  const { view } = make();

  first.focus();
  view.show();
  await slid();
  view.close();
  assert.equal(document.activeElement, first);

  second.focus();
  view.show();
  await slid();
  view.close();
  assert.equal(document.activeElement, second);
});
