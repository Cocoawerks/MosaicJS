// A tag in a `.ib.xml` that names an object rather than a view: constructed,
// handed to its outlet, woken when the page is on screen and told when it
// goes — and never drawn.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/** An object of the kind a page would place: no drawing anywhere on it. */
class Formatter {
  constructor(props) {
    this.built = props;
  }
  format(n) {
    return `${this.prefix ?? ""}${n}`;
  }
}

/** A compiled `.ib.xml`, as the compiler emits one. */
function markup(fn) {
  fn.isMarkup = true;
  return fn;
}

/** The first child of the one element the pages below draw. */
function inside(root) {
  return root.childNodes[0].childNodes[0];
}

test("a plain class is constructed rather than called, and draws nothing", () => {
  const root = document.createElement("div");
  const controller = {};
  mount(
    markup(() => h("div", null, h(Formatter, { prefix: "£", ref: (o) => (controller.money = o) }))),
    root,
    {},
    controller,
  );

  assert.equal(root.textContent, "");
  assert.equal(root.childNodes[0].childNodes.length, 1);
  assert.equal(inside(root).nodeType, 8);
  assert.ok(inside(root).__ibObj instanceof Formatter);
});

test("the tag's attributes reach the object, at construction and after", () => {
  const controller = {};
  const root = document.createElement("div");
  mount(
    markup(() => h("div", null, h(Formatter, { prefix: "£", ref: (o) => (controller.money = o) }))),
    root,
    {},
    controller,
  );

  const money = controller.money;
  assert.ok(money instanceof Formatter);
  assert.equal(money.built.prefix, "£");
  assert.equal(money.prefix, "£");
  assert.equal(money.format(3), "£3");
});

test("an outlet hands over the object, not the node it left behind", () => {
  const controller = {};
  const root = document.createElement("div");
  mount(
    markup(function () {
      return h("div", null, h(Formatter, { ref: (o) => (this.money = o) }));
    }),
    root,
    {},
    controller,
  );

  assert.ok(controller.money instanceof Formatter);
  assert.equal(controller.money.nodeType, undefined);
});

test("a class with draw() is still a component", () => {
  class Widget extends Component {
    draw() {
      return h("span", null, "drawn");
    }
  }
  const root = document.createElement("div");
  mount(markup(() => h("div", null, h(Widget, null))), root, {}, {});
  assert.equal(root.textContent, "drawn");
});

test("a hand-written function component is still called, not constructed", () => {
  const Icon = function () {
    return h("i", null, "icon");
  };
  const root = document.createElement("div");
  mount(markup(() => h("div", null, h(Icon, null))), root, {}, {});
  assert.equal(root.textContent, "icon");
});

test("a tag naming an object places that object itself", () => {
  const service = { calls: 0 };
  const controller = {};
  const root = document.createElement("div");
  mount(
    markup(() => h("div", null, h(service, { ref: (o) => (controller.service = o) }))),
    root,
    {},
    controller,
  );

  assert.equal(controller.service, service);
  // An object literal carries no name into the value — `Rates` names a binding
  // in a file and nothing more — so its comment says what it is instead.
  assert.equal(inside(root).data.trim(), "object");
});

test("the comment an object tag leaves behind names the class", () => {
  const root = document.createElement("div");
  mount(markup(() => h("div", null, h(Formatter, null))), root, {}, {});
  assert.equal(inside(root).data.trim(), "Formatter");
});

test("an object is woken once the page is on screen, and told when it goes", () => {
  const seen = [];
  class Feed {
    awakeFromMib() {
      seen.push("awake");
    }
    detached() {
      seen.push("gone");
    }
  }

  const root = document.createElement("div");
  document.body.appendChild(root);
  const unmount = mount(
    markup(() => h("div", null, h(Feed, null))),
    root,
    {},
    {},
  );
  assert.deepEqual(seen, ["awake"]);

  unmount();
  assert.deepEqual(seen, ["awake", "gone"]);
});

test("the object survives the page around it redrawing", () => {
  class Store {
    constructor() {
      this.edits = 0;
    }
  }

  const placed = [];
  class Page extends Component {
    static properties = { label: { type: String, default: "one" } };
    draw() {
      return h(
        "div",
        null,
        h(Store, {
          scale: this.label,
          ref: (o) => {
            this.store = o;
            placed.push(o);
          },
        }),
        h("span", null, this.label),
      );
    }
  }

  const root = document.createElement("div");
  document.body.appendChild(root);
  const unmount = mount(Page, root, {}, undefined);
  const page = unmount.view;

  const first = page.store;
  first.edits = 7;

  page.label = "two";
  page.needsDisplay();

  assert.equal(root.textContent, "two");
  // The same object, still holding what it was told, and its outlet pointing
  // at it again.
  assert.ok(placed.length >= 2);
  assert.equal(page.store, first);
  assert.equal(page.store.edits, 7);
  // And what the tag now says reached it.
  assert.equal(first.scale, "two");
});

test("a different object tag in the same place replaces the one there", () => {
  const gone = [];
  class First {
    detached() {
      gone.push("first");
    }
  }
  class Second {}

  class Page extends Component {
    static properties = { second: { type: Boolean, default: false } };
    draw() {
      return h("div", null, this.second ? h(Second, null) : h(First, null));
    }
  }

  const root = document.createElement("div");
  document.body.appendChild(root);
  const unmount = mount(Page, root, {}, undefined);
  const page = unmount.view;

  page.second = true;
  page.needsDisplay();

  assert.deepEqual(gone, ["first"]);
  assert.ok(inside(root).__ibObj instanceof Second);
});
