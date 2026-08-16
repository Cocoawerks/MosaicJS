// ListView, ProgressiveListView and ListItem, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {mount, h} = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const {ListItem, ListView, ProgressiveListView} = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

/** A row of a person's name — what an application writes. */
class PersonItem extends ListItem {
  draw() {
    return h("span", {class: "person"}, `${this.index}: ${this.content.name}`);
  }
}

const people = (count) =>
  Array.from({length: count}, (_, i) => ({name: `Person ${i}`}));

/** Mount a list of `count` people. */
function list(Type = ListView, props = {}, count = 3) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(Type, host, {...props, children: [h(PersonItem, {})]}).view;
  if (count > 0) view.content = people(count);

  const el = host.childNodes[0];
  return {
    host,
    view,
    el,
    scroller: el.childNodes[0],
    rows: () => el.querySelectorAll("span").filter((s) => s.getAttribute("class")?.includes("person")),
  };
}

// --- ListView ----------------------------------------------------------------

test("a list draws a row per thing it holds, in the kind of row it was given", () => {
  const {el, view, rows} = list();

  assert.ok(classesOf(el).includes("v-List"));
  assert.equal(el.getAttribute("role"), "listbox");
  assert.equal(view.count, 3);
  assert.deepEqual(rows().map((r) => r.textContent), [
    "0: Person 0",
    "1: Person 1",
    "2: Person 2",
  ]);
});

test("each row is handed its own, and where it sits", () => {
  const {el} = list();
  const lines = el.querySelectorAll("div").filter((d) => classesOf(d).includes("v-List-item"));

  assert.equal(lines.length, 3);
  assert.equal(lines[1].getAttribute("role"), "option");
  assert.equal(lines[1].textContent, "1: Person 1");
});

test("a row with nothing said about it reads as its datum does", () => {
  const host = document.createElement("div");
  const view = mount(ListView, host, {}).view;
  view.content = ["one", "two"];

  assert.equal(host.childNodes[0].textContent, "onetwo");
});

test("an empty list says so, in the words it was given", () => {
  const {el, view} = list(ListView, {emptyText: "Nobody here"}, 0);

  assert.ok(classesOf(el).includes("empty"));
  assert.equal(el.textContent, "Nobody here");

  view.content = people(2);
  assert.equal(classesOf(el).includes("empty"), false);
});

test("adding and removing changes what is drawn", () => {
  const {view, rows} = list();

  view.add({name: "Someone"});
  assert.equal(rows().length, 4);
  assert.equal(rows()[3].textContent, "3: Someone");

  view.remove(view.content[0]);
  assert.equal(rows().length, 3);
  assert.equal(rows()[0].textContent, "0: Person 1", "and the rest are renumbered");

  view.removeAll();
  assert.equal(rows().length, 0);
});

test("a load shows nothing at first: a quick answer never flashes a spinner", async () => {
  const {el, view} = list(ListView, {emptyText: "Nobody here"}, 0);

  view.setLoading(true);
  assert.equal(view.isLoading, true);
  assert.equal(classesOf(el).includes("loading"), false, "not yet");

  view.setLoading(false);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(classesOf(el).includes("loading"), false, "and never");
});

test("but one that runs on puts a spinner up, and content takes it down", async () => {
  const {el, view} = list(ListView, {}, 0);

  view.setLoading(true);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.ok(classesOf(el).includes("loading"));

  view.content = people(2);
  assert.equal(classesOf(el).includes("loading"), false);
  assert.equal(view.isLoading, false, "content is an answer");
});

// --- ProgressiveListView -----------------------------------------------------

/** A scroller of a known size, since there is no layout here. */
function sized(view, {height = 100, scrollTop = 0} = {}) {
  Object.defineProperty(view.scroller, "offsetHeight", {value: height, configurable: true});
  view.scroller.scrollTop = scrollTop;
}

test("a progressive list is as tall as everything it holds", () => {
  const {view, el} = list(ProgressiveListView, {itemHeight: "20"}, 500);

  assert.ok(classesOf(el).includes("v-ProgressiveList"));
  assert.equal(view.totalHeight, 500 * 20);
  assert.equal(el.querySelectorAll("div")[1].style.height, "10000px");
});

test("and draws only the rows in view, with a little either side", () => {
  const {view, rows} = list(ProgressiveListView, {itemHeight: "20", extension: "0", batch: "0"}, 500);

  sized(view, {height: 100});
  view.visibleRangeChanged();

  // 100px of window over 20px rows is five of them.
  assert.equal(rows().length, 5);
  assert.equal(rows()[0].textContent, "0: Person 0");
  assert.equal(view.totalHeight, 10000, "though it is as tall as all five hundred");
});

test("scrolling draws the ones that came into view", () => {
  const {view, rows} = list(ProgressiveListView, {itemHeight: "20", extension: "0", batch: "0"}, 500);

  sized(view, {height: 100});
  view.visibleRangeChanged();

  sized(view, {height: 100, scrollTop: 2000});
  view.visibleRangeChanged();

  assert.equal(rows()[0].textContent, "100: Person 100");
  assert.equal(rows().length, 5);
});

test("a row is placed at its own offset", () => {
  const {view, el} = list(ProgressiveListView, {itemHeight: "20", extension: "0", batch: "0"}, 500);

  sized(view, {height: 100});
  view.visibleRangeChanged();

  const lines = el.querySelectorAll("div").filter((d) => classesOf(d).includes("v-List-item"));
  assert.equal(lines[0].style.top, "0px");
  assert.equal(lines[2].style.top, "40px");
  assert.equal(lines[2].style.height, "20px");
});

test("rows of different heights are placed by what each is worth", () => {
  const {view, el} = list(
    ProgressiveListView,
    {itemHeight: (index) => (index % 2 === 0 ? 10 : 30), extension: "0", batch: "0"},
    10,
  );

  sized(view, {height: 100});
  view.visibleRangeChanged();

  const lines = el.querySelectorAll("div").filter((d) => classesOf(d).includes("v-List-item"));
  assert.equal(lines[0].style.top, "0px");
  assert.equal(lines[1].style.top, "10px");
  assert.equal(lines[2].style.top, "40px");
  assert.equal(view.totalHeight, 5 * 10 + 5 * 30);
});

test("the reach either side is what the markup asked for", () => {
  const {view, rows} = list(ProgressiveListView, {itemHeight: "20", extension: "40", batch: "2"}, 500);

  sized(view, {height: 100, scrollTop: 2000});
  view.visibleRangeChanged();

  // 40px of reach is two more rows each way, and the batch two more again.
  assert.equal(rows()[0].textContent, "96: Person 96");
  assert.equal(rows().length, 5 + 2 * (2 + 2));
});

test("scrolling reuses the rows already drawn rather than building them again", () => {
  // A row is a slot, and the datum in it changing is a patch. Keyed by index it
  // would not be: a window's indices all shift by one as it scrolls, so every
  // row would read as a new one and the whole window would be rebuilt to move
  // it by a single row.
  const {view, rows} = list(ProgressiveListView, {itemHeight: "20", extension: "0", batch: "0"}, 500);

  sized(view, {height: 100, scrollTop: 2000});
  view.visibleRangeChanged();
  const before = rows();

  // Counted rather than timed: what costs is the building, and a scroll of one
  // row should build one row's worth at most — not a window's.
  let built = 0;
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    built++;
    return create(tag);
  };
  view.scroller.scrollTop = 2020;
  view.visibleRangeChanged();
  document.createElement = create;

  assert.equal(built, 0, "the row that left is the row that came back, filled in again");
  assert.equal(rows()[0].textContent, "101: Person 101", "and it says what it now holds");
  // The nodes stay where they are and the data moves through them, which is the
  // whole of what a slot means. `ok` rather than `equal`: a failed comparison of
  // two DOM nodes would try to print the difference between two whole trees.
  assert.ok(rows()[0] === before[0], "the first row is the one that was there");
  assert.ok(rows().at(-1) === before.at(-1), "and so is the last");
});
