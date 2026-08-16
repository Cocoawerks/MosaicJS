// AccordionView, AccordionSection and Box, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { AccordionSection, AccordionView, Box } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el, target = el) => el.dispatchEvent({ type: "click", target });
const keyDown = (el, key, target = el) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    target,
    preventDefault: () => (prevented = true),
  });
  return prevented;
};

// --- Box ---------------------------------------------------------------------

/** Mount a box holding two lines. */
function box(props = {}) {
  const host = document.createElement("div");
  const view = mount(Box, host, {
    ...props,
    children: [h("p", {}, "one"), h("p", {}, "two")],
  }).view;
  const el = host.childNodes[0];
  return { host, view, el, title: el.childNodes[0], content: el.childNodes[1] };
}

test("a box draws its title above a well for what it holds", () => {
  const { el, title, content } = box({ title: "Colours" });

  assert.deepEqual(classesOf(el), ["v-Box"]);
  assert.equal(el.getAttribute("role"), "group");
  assert.equal(el.getAttribute("aria-label"), "Colours");

  assert.deepEqual(classesOf(title), ["v-Box-title"]);
  assert.equal(title.textContent, "Colours");

  assert.deepEqual(classesOf(content), ["v-Box-content"]);
  assert.equal(content.textContent, "onetwo", "and what it holds is in it");
});

test("a box with no title is drawn without one", () => {
  const { el, title } = box();

  assert.equal(title.style.display, "none");
  assert.equal(title.getAttribute("aria-hidden"), "true");
  assert.equal(el.getAttribute("aria-label"), null);
});

test("its title can be changed, and comes back", () => {
  const { view, title } = box({ title: "Colours" });

  view.title = "Sizes";
  assert.equal(title.textContent, "Sizes");
});

// --- AccordionView -----------------------------------------------------------

/** The sections a view is given: three, of which one starts open. */
const someSections = () => [
  h(
    AccordionSection,
    { title: "Delivery", value: "delivery", expanded: "true" },
    h("p", {}, "where it goes"),
  ),
  h(AccordionSection, { title: "Payment", value: "payment" }, h("input", {})),
  h(
    AccordionSection,
    { title: "Notes", value: "notes" },
    h("p", {}, "anything else"),
  ),
];

/** Mount a view, and hand back what a test needs to work it. */
function accordion(props = {}, children = someSections()) {
  const host = document.createElement("div");
  const view = mount(AccordionView, host, { ...props, children }).view;
  const el = host.childNodes[0];
  return {
    host,
    view,
    el,
    panels: () => el.childNodes,
    headerOf: (i) => el.childNodes[i].childNodes[0],
  };
}

/** Which sections are open, by what they read. */
const openOnes = (panels) =>
  panels
    .filter((panel) => classesOf(panel).includes("expanded"))
    .map((panel) => panel.childNodes[0].childNodes[0].textContent);

test("an accordion draws a section per AccordionSection", () => {
  const { el, panels, headerOf } = accordion();

  assert.deepEqual(classesOf(el), ["v-accordionPanel"]);
  assert.equal(el.tagName, "ul");
  assert.equal(panels().length, 3);
  assert.equal(panels()[0].tagName, "li");
  assert.deepEqual(classesOf(headerOf(0)), ["header"]);
});

test("a header says it is a button, and names what it opens", () => {
  const { el, headerOf } = accordion();
  const header = headerOf(0);

  assert.equal(header.getAttribute("role"), "button");
  assert.equal(header.getAttribute("tabindex"), "0");
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.equal(
    header.getAttribute("aria-controls"),
    el.childNodes[0].childNodes[1].getAttribute("id"),
    "which is the section's own content",
  );
});

test("the markup says which sections start open", () => {
  const { view, panels } = accordion();

  assert.deepEqual(openOnes(panels()), ["Delivery"]);
  assert.equal(view.isExpanded("delivery"), true);
  assert.equal(view.isExpanded("payment"), false);
});

test("pressing a header opens that section, and says so", () => {
  const said = [];
  const { view, panels, headerOf } = accordion({
    action: (v, value, expanded) => said.push(`${value}:${expanded}`),
  });

  click(headerOf(1));
  assert.deepEqual(
    openOnes(panels()),
    ["Delivery", "Payment"],
    "more than one may be open",
  );
  assert.deepEqual(said, ["payment:true"]);

  click(headerOf(1));
  assert.deepEqual(openOnes(panels()), ["Delivery"]);
  assert.deepEqual(said, ["payment:true", "payment:false"]);
});

test("the space bar works a header as the pointer does", () => {
  const { view, headerOf } = accordion();

  assert.ok(keyDown(headerOf(1), " "), "the key is taken");
  assert.equal(view.isExpanded("payment"), true);
});

test("a press on what a section holds is not a press on its header", () => {
  const { view, el } = accordion();
  const inside = el.childNodes[1].childNodes[1];

  click(el.childNodes[1], inside);
  assert.equal(view.isExpanded("payment"), false);
});

test("expandAll opens every section, and shuts every one", () => {
  const { view, panels } = accordion();

  view.expandAll();
  assert.equal(openOnes(panels()).length, 3);

  view.expandAll(false);
  assert.deepEqual(openOnes(panels()), []);
});

test("and opening in code says nothing, as it is not the user doing it", () => {
  const said = [];
  const { view } = accordion({ action: (v, value) => said.push(value) });

  view.setExpanded("payment", true);
  view.expandAll();
  assert.deepEqual(said, []);
});

test("what a section holds is drawn whether it is open or not", () => {
  const { el, headerOf } = accordion();
  const field = el.childNodes[1].querySelectorAll("input")[0];

  field.value = "half typed";
  click(headerOf(1));
  click(headerOf(1));

  assert.equal(
    el.childNodes[1].querySelectorAll("input")[0],
    field,
    "the same field, not another",
  );
  assert.equal(field.value, "half typed");
});
