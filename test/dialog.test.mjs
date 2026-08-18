// DialogBox, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no native `<dialog>` behind the shim, so what `showModal()` does to
// the top layer is not what these check — that is checked in the browser, by
// the example's own page. What they check is what the dialog does: what it
// draws, where a child ends up, what opening and closing report, and who gets
// to refuse a close.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import "./dom-shim.mjs";

const { mount, h } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const { DialogBox, addOpenListener, removeOpenListener } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/**
 * Every dialog a test made, so none is left up: the shared mask counts what is
 * open across the whole page, and one dialog left behind would keep it raised
 * for the next test.
 */
const made = new Set();

afterEach(async () => {
  for (const view of made) view.forceClose();
  made.clear();
  // Past the mask's linger, so it has actually gone before the next test looks.
  await new Promise((resolve) => setTimeout(resolve, 60));
});

/** Mount a dialog with something in each of its regions. */
function make(props = {}, children = null) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(DialogBox, host, {
    title: "Settings",
    ...props,
    children: children ?? [
      h("p", {}, "content"),
      h("button", { slot: "footer", class: "v-Button primary" }, "Save"),
    ],
  }).view;

  made.add(view);
  return { host, view, el: host.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

/** The wrapper's three regions, in the order the dialog draws them. */
const regionsOf = (el) => el.childNodes[0].childNodes;

/** A macrotask tick, which is what each step of the show sequence waits for. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Let the show sequence run through. Waited on rather than slept through: the
 * two steps are a timer and a frame, and how long either takes is the host's
 * business — a fixed delay is a race under a loaded test runner.
 */
async function settle(view) {
  for (let i = 0; i < 100 && (!view || view.measuring); i++) await tick();
  await tick();
}

/** Open a dialog and wait for it to have finished opening. */
async function open(props = {}, children = null) {
  const dialog = make(props, children);
  dialog.view.show();
  await settle(dialog.view);
  return dialog;
}

const typeKeyIn = (el, key, extra = {}) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    preventDefault: () => (prevented = true),
    ...extra,
  });
  return prevented;
};

// --- what it draws -----------------------------------------------------------

test("draws the ported markup: the box, its wrapper and the three regions", () => {
  const { el } = make();

  assert.equal(el.tagName, "dialog");
  assert.deepEqual(classesOf(el), ["v-Dialog", "v-Dialog--no-mask"]);

  const wrapper = el.childNodes[0];
  assert.equal(wrapper.tagName, "div");

  const [header, main, footer] = regionsOf(el);
  assert.equal(header.tagName, "header");
  assert.equal(main.tagName, "main");
  assert.equal(footer.tagName, "footer");
});

test("the header carries the title and the close button, in that order", () => {
  const [header] = regionsOf(make({ title: "Preferences" }).el);

  const title = header.childNodes[0];
  assert.equal(title.tagName, "h2");
  assert.equal(title.textContent, "Preferences");

  const close = header.childNodes[1];
  assert.equal(close.tagName, "button");
  assert.ok(classesOf(close).includes("close"));
});

test("a child naming no slot is content; slot=footer puts it in the footer", () => {
  const [, main, footer] = regionsOf(make().el);

  assert.equal(main.childNodes.length, 1);
  assert.equal(main.childNodes[0].tagName, "p");

  assert.equal(footer.childNodes.length, 1);
  assert.equal(footer.childNodes[0].textContent, "Save");
});

test("slot=header puts a child in the header, before the title", () => {
  const { el } = make({}, [
    h("span", { slot: "header" }, "status"),
    h("p", {}, "content"),
  ]);

  const [header] = regionsOf(el);
  assert.equal(header.childNodes[0].tagName, "span");
  assert.equal(header.childNodes[1].tagName, "h2");
});

test("being up is drawn, so a closed dialog is neither boxed nor pressable", async () => {
  const { el, view } = make();

  // The sheet hangs `display` and `pointer-events` off this, not off the
  // `[open]` attribute: a closed dialog still matched as open stays laid out in
  // the middle of the page, invisible, taking presses meant for what is behind.
  assert.ok(!classesOf(el).includes("is-open"));

  view.show();
  await settle(view);
  assert.ok(classesOf(el).includes("is-open"));

  view.forceClose();
  assert.ok(!classesOf(el).includes("is-open"));
});

test("pack and mask are said in the class list", () => {
  assert.ok(classesOf(make({ pack: "true" }).el).includes("v-Dialog--auto"));
  // Modal and masked: the shared overlay does the dimming, so the dialog's own
  // backdrop is kept clear.
  assert.ok(classesOf(make().el).includes("v-Dialog--no-mask"));
  // Nothing to keep clear when there is no mask, and nothing when it is not modal.
  assert.ok(!classesOf(make({ mask: "false" }).el).includes("v-Dialog--no-mask"));
  assert.ok(
    !classesOf(make({ modal: "false" }).el).includes("v-Dialog--no-mask"),
  );
});

// --- opening -----------------------------------------------------------------

test("it is measured invisibly first, and revealed once it has been", async () => {
  const { el, view } = make();

  view.show();
  assert.ok(view.open);
  assert.ok(classesOf(el).includes("is-measuring"));

  await settle(view);
  assert.ok(!classesOf(el).includes("is-measuring"));
});

test("opening reports once it is up, not while it is being measured", async () => {
  const seen = [];
  const { view } = make({ onOpen: () => seen.push("open") });

  view.show();
  assert.deepEqual(seen, []);

  await settle(view);
  assert.deepEqual(seen, ["open"]);
});

test("the action hears opening and closing, with which it was", async () => {
  const seen = [];
  const { view } = await open({ action: (_, open) => seen.push(open) });

  assert.deepEqual(seen, [true]);
  view.forceClose();
  assert.deepEqual(seen, [true, false]);
});

test("showing twice does nothing the second time", async () => {
  const seen = [];
  const { view } = await open({ onOpen: () => seen.push("open") });

  view.show();
  await settle(view);
  assert.deepEqual(seen, ["open"]);
});

test("anything listening hears that a dialog opened", async () => {
  let heard = 0;
  const listener = () => (heard += 1);

  addOpenListener(listener);
  await open();
  assert.equal(heard, 1);

  removeOpenListener(listener);
  await open();
  assert.equal(heard, 1);
});

test("the close button takes first focus", async () => {
  const { el } = await open();
  const close = regionsOf(el)[0].childNodes[1];

  assert.equal(document.activeElement, close);
});

// --- closing -----------------------------------------------------------------

test("closing reports, and says it is down", async () => {
  const seen = [];
  const { view } = await open({ onClose: () => seen.push("close") });

  assert.equal(view.close(), true);
  assert.equal(view.open, false);
  assert.deepEqual(seen, ["close"]);
});

test("the close button closes it", async () => {
  const { el, view } = await open();

  regionsOf(el)[0].childNodes[1].dispatchEvent({ type: "click" });
  assert.equal(view.open, false);
});

test("an approver can refuse a close, and is asked every time", async () => {
  const { view } = await open();

  let allow = false;
  let asked = 0;
  view.closeApprover = () => {
    asked += 1;
    return allow;
  };

  assert.equal(view.close(), false);
  assert.equal(view.open, true);
  assert.equal(asked, 1);

  allow = true;
  assert.equal(view.close(), true);
  assert.equal(view.open, false);
  assert.equal(asked, 2);
});

test("forceClose goes past the approver", async () => {
  const { view } = await open();
  view.closeApprover = () => false;

  view.forceClose();
  assert.equal(view.open, false);
});

test("closing a dialog that is already down reports nothing", async () => {
  const seen = [];
  const { view } = await open({ onClose: () => seen.push("close") });

  view.forceClose();
  view.forceClose();
  assert.deepEqual(seen, ["close"]);
});

test("visible opens it and closes it", async () => {
  const { view } = make();

  view.visible = true;
  await settle(view);
  assert.equal(view.visible, true);

  view.visible = false;
  assert.equal(view.visible, false);
});

// --- the keyboard ------------------------------------------------------------

test("Escape closes it, and calls off the UA's own dismissal", async () => {
  const { el, view } = await open();

  assert.equal(typeKeyIn(el, "Escape"), true);
  assert.equal(view.open, false);
});

test("Escape is put to the approver like any other close", async () => {
  const { el, view } = await open();
  view.closeApprover = () => false;

  typeKeyIn(el, "Escape");
  assert.equal(view.open, true);
});

test("Escape goes no further: one press dismisses one dialog", async () => {
  const { el } = await open();

  let travelled = false;
  const outer = el.parentNode;
  outer.addEventListener("keydown", () => (travelled = true));

  typeKeyIn(el, "Escape");
  assert.equal(travelled, false);
});

test("Enter presses the primary button", async () => {
  const { el } = await open();
  const primary = regionsOf(el)[2].childNodes[0];

  let pressed = false;
  primary.addEventListener("click", () => (pressed = true));

  assert.equal(typeKeyIn(el, "Enter"), true);
  assert.equal(pressed, true);
});

test("Enter leaves a disabled primary button alone", async () => {
  const { el } = await open({}, [
    h("button", { slot: "footer", class: "v-Button primary is-disabled" }, "Save"),
  ]);

  let pressed = false;
  regionsOf(el)[2].childNodes[0].addEventListener(
    "click",
    () => (pressed = true),
  );

  assert.equal(typeKeyIn(el, "Enter"), false);
  assert.equal(pressed, false);
});

test("Enter is left alone where a newline is what it means", async () => {
  const { el } = await open();
  const primary = regionsOf(el)[2].childNodes[0];

  let pressed = false;
  primary.addEventListener("click", () => (pressed = true));

  const editor = document.createElement("textarea");
  editor.focus();

  assert.equal(typeKeyIn(el, "Enter"), false);
  assert.equal(pressed, false);
});

test("Enter with a modifier, or already acted on, is not the dialog's", async () => {
  const { el } = await open();
  const primary = regionsOf(el)[2].childNodes[0];

  let pressed = 0;
  primary.addEventListener("click", () => (pressed += 1));

  typeKeyIn(el, "Enter", { shiftKey: true });
  typeKeyIn(el, "Enter", { metaKey: true });
  typeKeyIn(el, "Enter", { defaultPrevented: true });
  assert.equal(pressed, 0);
});

// --- the shared mask ---------------------------------------------------------

test("a modal dialog raises the shared mask, and drops it when it goes", async () => {
  const { view } = await open();

  const mask = document.querySelector(".v-Dialog-mask");
  assert.ok(mask);
  assert.ok(mask.getAttribute("class").includes("is-visible"));
  assert.equal(mask.getAttribute("aria-hidden"), "true");

  view.forceClose();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(!mask.getAttribute("class").includes("is-visible"));
});

test("the mask stays up while any modal is, and there is only ever one", async () => {
  const first = await open();
  const second = await open();

  assert.equal(document.body.querySelectorAll(".v-Dialog-mask").length, 1);
  const mask = document.querySelector(".v-Dialog-mask");

  first.view.forceClose();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(mask.getAttribute("class").includes("is-visible"));

  second.view.forceClose();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(!mask.getAttribute("class").includes("is-visible"));
});

test("a dialog that is not modal raises no mask", async () => {
  const { view } = await open({ modal: "false" });

  const mask = document.querySelector(".v-Dialog-mask");
  assert.ok(!mask || !mask.getAttribute("class").includes("is-visible"));
  view.forceClose();
});
