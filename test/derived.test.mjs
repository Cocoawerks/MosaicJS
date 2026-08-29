// A `{path}` that names a getter watches what the getter reads.
//
// A binding watches the property it names, and a getter is never assigned — so
// naming one used to put a watch on nothing at all. It came right only because
// every binding is re-read whenever anything else observed on the same
// controller is assigned, which on an interface whose only reading is the derived
// value is nothing: a slider bound to `amount` behind a `{formatted}` that
// reads it left the reading behind the drag until some other part of the interface
// happened to change.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { bindProp } from "../src/js/core/runtime/private/bindProp.js";
import { bindText } from "../src/js/core/runtime/private/bindText.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/** A compiled `.ib.xml` whose only reading is `{path}`, as codegen emits one. */
function pageOf(path) {
  const mib = function () {
    return h("p", null, bindText(this, path));
  };
  mib.isMarkup = true;
  return mib;
}

test("a getter's own state is watched, and assigning it redraws", () => {
  const controller = {
    amount: 1250,
    get formatted() {
      return `£${this.amount}`;
    },
  };

  const root = document.createElement("div");
  mount(pageOf("formatted"), root, {}, controller);
  assert.equal(root.textContent, "£1250");

  // Nothing else on this interface is observed, so this is the only thing that can
  // bring the reading up to date.
  controller.amount = 3000;
  assert.equal(root.textContent, "£3000");
});

test("through a getter that reads another getter", () => {
  const controller = {
    amount: 100,
    rate: 2,
    get converted() {
      return this.amount * this.rate;
    },
    get formatted() {
      return `= ${this.converted}`;
    },
  };

  const root = document.createElement("div");
  mount(pageOf("formatted"), root, {}, controller);
  assert.equal(root.textContent, "= 200");

  controller.amount = 150;
  assert.equal(root.textContent, "= 300");
  controller.rate = 3;
  assert.equal(root.textContent, "= 450");
});

test("a getter on a class, which is where a controller usually keeps one", () => {
  class Controller {
    constructor() {
      this.name = "";
    }
    get greeting() {
      return this.name ? `hello, ${this.name}` : "nobody yet";
    }
  }

  const controller = new Controller();
  const root = document.createElement("div");
  mount(pageOf("greeting"), root, {}, controller);
  assert.equal(root.textContent, "nobody yet");

  controller.name = "Ada";
  assert.equal(root.textContent, "hello, Ada");
});

test("the getter goes on being the getter — it is not read once and kept", () => {
  const controller = {
    count: 0,
    limit: 3,
    get status() {
      return this.count >= this.limit ? "full" : "room";
    },
  };

  const root = document.createElement("div");
  mount(pageOf("status"), root, {}, controller);
  assert.equal(root.textContent, "room");

  controller.count = 5;
  assert.equal(root.textContent, "full");
  controller.limit = 9;
  assert.equal(root.textContent, "room");
});

test("plain state still works, and is not made into anything else", () => {
  const controller = { count: 1 };

  const root = document.createElement("div");
  mount(pageOf("count"), root, {}, controller);
  assert.equal(root.textContent, "1");

  controller.count = 2;
  assert.equal(root.textContent, "2");
});

test("a getter that reads nothing of the controller's costs nothing", () => {
  const controller = {
    get fixed() {
      return "always";
    },
  };

  const root = document.createElement("div");
  mount(pageOf("fixed"), root, {}, controller);
  assert.equal(root.textContent, "always");
});

test("a getter that throws is left to the read that already answered for it", () => {
  const controller = {
    get broken() {
      throw new Error("no");
    },
  };

  const root = document.createElement("div");
  // The value is read before the binding is registered, so this is the throw
  // the interface already had. What matters is that watching adds no second one.
  assert.throws(() => mount(pageOf("broken"), root, {}, controller), /no/);
});

test("a bound prop on a component follows a getter's state too", () => {
  const drawn = [];
  class Label extends Component {
    static properties = { text: { type: String, default: "" } };
    draw() {
      drawn.push(this.text);
      return h("span", null, this.text);
    }
  }

  const controller = {
    rounding: false,
    get label() {
      return this.rounding ? "round" : "exact";
    },
  };

  const mib = function () {
    return h("div", null, h(Label, { text: bindProp(this, [{ path: "label" }]) }));
  };
  mib.isMarkup = true;
  mib.redraws = true;

  const root = document.createElement("div");
  mount(mib, root, {}, controller);
  assert.equal(root.textContent, "exact");

  controller.rounding = true;
  assert.equal(root.textContent, "round");
});
