// How far one assignment reaches.
//
// Every observed property on a controller used to share a single callback —
// `() => refresh(controller)` — which re-reads every binding the controller
// has. So `{name}` changing re-worked `{total}`, `{status}` and everything else
// on the interface, and the cost of an assignment grew with how much happened to be
// shown beside it. A binding is now recorded against the property it reads, and
// an assignment reaches those and no further.
//
// The exception is a bound prop. `<Button text="{label}"/>` cannot be written
// back into a node — what a Button does with `text` is the Button's own — so a
// property that feeds one still draws the view again. That is per property and
// not per file: an interface with one bound prop among fifty text bindings used to
// redraw for all fifty.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { bindAttr } from "../src/js/core/runtime/private/bindAttr.js";
import { bindProp } from "../src/js/core/runtime/private/bindProp.js";
import { bindText } from "../src/js/core/runtime/private/bindText.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/** A child whose `label` is a declared setting, as a Button's `text` is. */
class Label extends Component {
  static properties = { label: { type: String } };
  draw() {
    return h("span", null, this.get("label", ""));
  }
}

/**
 * An interface as codegen emits one: a text binding on `a`, and a bound prop worked
 * out from `b`. `redraws` is what the compiler writes for a file with a bound
 * prop — see codegen.js.
 */
function mixedPage(counter) {
  const mib = function () {
    counter.draws += 1;
    return h(
      "div",
      null,
      h("p", null, bindText(this, "a")),
      h(Label, { label: bindProp(this, [{ path: "b" }]) }),
    );
  };
  mib.isMarkup = true;
  mib.redraws = true;
  return mib;
}

test("a property that only feeds text does not redraw the view", () => {
  const counter = { draws: 0 };
  const controller = { a: "one", b: "first" };

  const root = document.createElement("div");
  mount(mixedPage(counter), root, {}, controller);
  const drawnOnce = counter.draws;

  controller.a = "two";

  assert.equal(root.querySelector("p").textContent, "two");
  assert.equal(counter.draws, drawnOnce, "the markup was run again for a text binding");
});

test("a property that feeds a bound prop still redraws the view", () => {
  const counter = { draws: 0 };
  const controller = { a: "one", b: "first" };

  const root = document.createElement("div");
  mount(mixedPage(counter), root, {}, controller);
  const drawnOnce = counter.draws;

  controller.b = "second";

  // The only way a prop can be worked out is by running the markup again.
  assert.ok(counter.draws > drawnOnce, "the markup was not run again for a prop");
  assert.equal(root.querySelector("span").textContent, "second");
});

test("an assignment reads only the bindings that name the property", () => {
  // The behaviour the index is for. `other` is never assigned, and nothing
  // should read it when `shown` changes.
  let otherReads = 0;
  const controller = {
    shown: "a",
    get other() {
      otherReads += 1;
      return "unchanging";
    },
  };

  const mib = function () {
    return h(
      "div",
      null,
      h("p", null, bindText(this, "shown")),
      h("p", null, bindText(this, "other")),
    );
  };
  mib.isMarkup = true;

  const root = document.createElement("div");
  mount(mib, root, {}, controller);

  otherReads = 0;
  controller.shown = "b";

  assert.equal(root.querySelectorAll("p")[0].textContent, "b");
  assert.equal(otherReads, 0, "an unrelated binding was re-read");
});

test("a binding on a getter follows the state the getter reads", () => {
  // A getter is never assigned, so watching it watches nothing: the binding is
  // recorded against what the getter read instead. Assigning that has to reach
  // it, and it is the only thing on the interface that can bring it up to date.
  const controller = {
    amount: 1250,
    get formatted() {
      return `£${this.amount}`;
    },
  };

  const mib = function () {
    return h("p", null, bindText(this, "formatted"));
  };
  mib.isMarkup = true;

  const root = document.createElement("div");
  mount(mib, root, {}, controller);
  assert.equal(root.textContent, "£1250");

  controller.amount = 3000;
  assert.equal(root.textContent, "£3000");
});

test("an attribute made of several properties updates from either", () => {
  const controller = { kind: "warn", size: "big" };

  const mib = function () {
    return h("div", {
      class: bindAttr(this, [{ path: "kind" }, " ", { path: "size" }]),
    });
  };
  mib.isMarkup = true;

  const root = document.createElement("div");
  mount(mib, root, {}, controller);
  assert.equal(root.childNodes[0].getAttribute("class"), "warn big");

  controller.kind = "error";
  assert.equal(root.childNodes[0].getAttribute("class"), "error big");

  controller.size = "small";
  assert.equal(root.childNodes[0].getAttribute("class"), "error small");
});

test("two bindings on one property both come up to date", () => {
  const controller = { name: "one" };

  const mib = function () {
    return h(
      "div",
      null,
      h("p", null, bindText(this, "name")),
      h("em", null, bindText(this, "name")),
      h("i", { title: bindAttr(this, [{ path: "name" }]) }),
    );
  };
  mib.isMarkup = true;

  const root = document.createElement("div");
  mount(mib, root, {}, controller);

  controller.name = "two";

  assert.equal(root.querySelector("p").textContent, "two");
  assert.equal(root.querySelector("em").textContent, "two");
  assert.equal(root.querySelector("i").getAttribute("title"), "two");
});

test("bindings are not accumulated by redrawing", () => {
  // A view re-tracks its bindings on every draw. The index is emptied with the
  // list it indexes, so the same binding is recorded once however many times
  // the view has drawn.
  const counter = { draws: 0 };
  const controller = { a: "one", b: "first" };

  const root = document.createElement("div");
  mount(mixedPage(counter), root, {}, controller);

  for (let i = 0; i < 20; i++) controller.b = `round ${i}`;

  controller.a = "final";
  assert.equal(root.querySelector("p").textContent, "final");
  assert.equal(root.querySelector("span").textContent, "round 19");
});
