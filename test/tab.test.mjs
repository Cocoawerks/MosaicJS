// TabView and DeckView, ported from GWT Mosaic (TabPanel) and GWT (DeckPanel).
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no layout here, so where the pill lands is not what these check —
// that is checked in a browser. What they check is which card is showing, what
// the bar says about itself, and that a card put away is not thrown away.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { DeckView, Tab, TabView } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const click = (el) => el.dispatchEvent({ type: "click" });
const keyDown = (el, key) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    preventDefault: () => (prevented = true),
  });
  return prevented;
};

// --- DeckView ----------------------------------------------------------------

/** Mount a deck of three cards. */
function deck(props = {}) {
  const host = document.createElement("div");
  const view = mount(DeckView, host, {
    ...props,
    children: [h("p", {}, "one"), h("p", {}, "two"), h("p", {}, "three")],
  }).view;
  const el = host.childNodes[0];
  return { host, view, el, cards: el.childNodes };
}

/** Which cards are showing, by what they read. */
const showing = (cards) =>
  cards
    .filter((card) => classesOf(card).includes("is-showing"))
    .map((card) => card.textContent);

test("a deck draws every card and shows one", () => {
  const { el, cards } = deck();

  assert.deepEqual(classesOf(el), ["v-Deck"]);
  assert.equal(cards.length, 3, "all three are drawn");
  assert.deepEqual(showing(cards), ["one"], "and one of them is showing");
});

test("the ones that are not showing are hidden from the page, not removed", () => {
  const { cards } = deck();

  assert.equal(cards[1].getAttribute("aria-hidden"), "true");
  assert.equal(cards[1].getAttribute("inert"), "");
  assert.equal(cards[1].textContent, "two", "and still hold what they held");
});

test("showing another card turns the deck over", () => {
  const { view, cards } = deck();

  view.show(2);
  assert.deepEqual(showing(cards), ["three"]);
  assert.equal(view.selectedIndex, 2);
});

test("a card that is not there is not shown", () => {
  const { view, cards } = deck();

  view.show(9);
  view.show(-1);
  view.show("nonsense");
  assert.deepEqual(showing(cards), ["one"]);
});

test("and turning it over says so only when asked", () => {
  const said = [];
  const { view } = deck({ action: (v, index) => said.push(index) });

  view.show(1);
  assert.deepEqual(said, [], "showWidget(i) tells no one, as in Java");

  view.show(2, true);
  assert.deepEqual(said, [2]);
});

test("the markup may say which card starts on top", () => {
  const { cards } = deck({ selectedIndex: "1" });

  assert.deepEqual(showing(cards), ["two"]);
});

// --- TabView -----------------------------------------------------------------

/** Mount a view of three tabs. */
function tabs(props = {}) {
  const host = document.createElement("div");
  const view = mount(TabView, host, {
    ...props,
    children: [
      h(Tab, { title: "Overview" }, h("p", {}, "first")),
      h(Tab, { title: "Details" }, h("input", {})),
      h(Tab, { title: "Settings" }, h("p", {}, "third")),
    ],
  }).view;

  const el = host.childNodes[0];
  const bar = el.childNodes[0];
  return {
    host,
    view,
    el,
    bar,
    // The pill is drawn first, so the tabs are what follows it.
    buttons: bar.childNodes.slice(1),
    cards: el.childNodes[1].childNodes,
  };
}

test("a tab view draws a bar of tabs over a deck of cards", () => {
  const { el, bar, buttons, cards } = tabs();

  assert.deepEqual(classesOf(el), ["v-TabPanel"]);
  assert.deepEqual(classesOf(bar), ["v-TabBar"]);
  assert.equal(bar.getAttribute("role"), "tablist");
  assert.equal(bar.getAttribute("tabindex"), "0", "the bar is the tab stop");

  assert.deepEqual(
    buttons.map((b) => b.textContent),
    ["Overview", "Details", "Settings"],
  );
  assert.equal(buttons[0].getAttribute("role"), "tab");
  assert.equal(cards.length, 3, "a card for what each tab holds");
});

test("the pill is drawn behind the tabs, and does not slide into place", () => {
  const { bar } = tabs();
  const pill = bar.childNodes[0];

  assert.ok(classesOf(pill).includes("v-TabBar-indicator"));
  assert.ok(
    classesOf(pill).includes("no-anim"),
    "there is nowhere to slide from",
  );
  assert.equal(pill.getAttribute("aria-hidden"), "true");
});

test("the first tab is the one chosen", () => {
  const { view, buttons, cards } = tabs();

  assert.equal(view.selectedIndex, 0);
  assert.ok(classesOf(buttons[0]).includes("is-selected"));
  assert.equal(buttons[0].getAttribute("aria-selected"), "true");
  assert.equal(buttons[1].getAttribute("aria-selected"), "false");
  assert.ok(classesOf(cards[0]).includes("is-showing"));
});

test("clicking a tab chooses it, and says which", () => {
  const said = [];
  const { view, buttons, cards } = tabs({
    action: (v, index, title) => said.push(`${index}:${title}`),
  });

  click(buttons[1]);
  assert.equal(view.selectedIndex, 1);
  assert.ok(classesOf(buttons[1]).includes("is-selected"));
  assert.ok(classesOf(cards[1]).includes("is-showing"));
  assert.deepEqual(said, ["1:Details"]);

  // Clicking the one already chosen is not a change.
  click(buttons[1]);
  assert.deepEqual(said, ["1:Details"]);
});

test("what a card holds survives being turned away from", () => {
  const { buttons, cards } = tabs();
  const field = cards[1].querySelectorAll("input")[0];

  field.value = "half typed";
  click(buttons[0]);
  click(buttons[1]);

  assert.equal(
    cards[1].querySelectorAll("input")[0].value,
    "half typed",
    "the same field, not another",
  );
});

test("the arrows walk the bar and stop at either end", () => {
  const { view, bar } = tabs();

  assert.ok(keyDown(bar, "ArrowRight"), "the key is taken");
  assert.equal(view.selectedIndex, 1);
  keyDown(bar, "ArrowRight");
  assert.equal(view.selectedIndex, 2);
  keyDown(bar, "ArrowRight");
  assert.equal(view.selectedIndex, 2, "and no further");

  keyDown(bar, "ArrowLeft");
  keyDown(bar, "ArrowLeft");
  assert.equal(view.selectedIndex, 0);
  keyDown(bar, "ArrowLeft");
  assert.equal(view.selectedIndex, 0, "nor before the first");
});

test("a tab chosen in code says nothing, as it is not the user choosing", () => {
  const said = [];
  const { view, cards } = tabs({ action: (v, index) => said.push(index) });

  view.selectTab(2);
  assert.equal(view.selectedIndex, 2);
  assert.ok(classesOf(cards[2]).includes("is-showing"));
  assert.deepEqual(said, []);
});

test("the markup may say which tab starts chosen", () => {
  const { view, buttons } = tabs({ selectedIndex: "2" });

  assert.equal(view.selectedIndex, 2);
  assert.ok(classesOf(buttons[2]).includes("is-selected"));
});

test("a tab draws nothing itself: what it holds is the deck's", () => {
  const host = document.createElement("div");
  mount(Tab, host, { title: "Overview", children: [h("p", {}, "first")] });

  // A component that draws nothing leaves a placeholder and no element: what
  // the tab holds is drawn by the view, as a card of its deck.
  assert.equal(host.querySelectorAll("p").length, 0);
  assert.equal(host.textContent, "");
});
