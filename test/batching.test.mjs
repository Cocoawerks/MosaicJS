// Several assignments, one drawing.
//
// A handler settling four fields drew four times: each assignment told its
// watchers and each of those re-ran `draw()`. Three of those drawings were
// thrown away by the next.
//
// What makes this safe is that the drawing is only *held*, never deferred past
// the moment something needs it. Mosaic's components measure what they have
// just drawn — a menu places itself by the rows it has, a slider reads its own
// width — so reading `node` or `nodes` draws whatever is owed first. These
// tests hold that door shut.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { batch } from "../src/js/core/runtime/private/batch.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/**
 * How many times `Panel` has drawn. Kept out here rather than on the instance:
 * a field the drawing reads and assigns is state like any other, so counting
 * on `this` would make every drawing ask for another.
 */
const counted = { draws: 0 };

/** A component with four fields and a handler that settles all of them. */
class Panel extends Component {
  constructor(props) {
    super(props);
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.d = 0;
  }
  click() {
    this.a += 1;
    this.b += 1;
    this.c += 1;
    this.d += 1;
  }
  draw() {
    counted.draws += 1;
    return h("button", null, `${this.a}${this.b}${this.c}${this.d}`);
  }
}

test("four assignments in one handler draw once", () => {
  const root = document.createElement("div");
  const view = mount(Panel, root).view;

  counted.draws = 0;
  root.childNodes[0].dispatchEvent({ type: "click" });

  assert.equal(counted.draws, 1, "the handler drew more than once");
  assert.equal(root.textContent, "1111");
});

test("the drawing has happened by the time the handler returns", () => {
  // Nothing outside the handler should ever see a DOM that has not caught up.
  const root = document.createElement("div");
  mount(Panel, root);

  root.childNodes[0].dispatchEvent({ type: "click" });
  assert.equal(root.textContent, "1111");
});

test("a handler that measures what it just drew sees the drawing", () => {
  // What ComboBox.showMenu does: assign, then read back the nodes to place
  // itself by them. Deferring the drawing past this point is the failure this
  // whole arrangement exists to avoid.
  let seen = null;

  class Measuring extends Component {
    constructor(props) {
      super(props);
      this.label = "before";
    }
    click() {
      this.label = "after";
      // Reading `node` is what draws whatever is owed.
      seen = this.node.textContent;
    }
    draw() {
      return h("button", null, this.label);
    }
  }

  const root = document.createElement("div");
  mount(Measuring, root);
  root.childNodes[0].dispatchEvent({ type: "click" });

  assert.equal(seen, "after", "the handler measured a stale DOM");
});

test("a handler that measures a child sees the child's drawing", () => {
  // The usual shape: a parent assigns something a child shows, then reaches
  // for the child's node. The parent's held drawing is what puts the child
  // there, so everything owed is drawn and not only the view being asked after.
  let seen = null;

  class Row extends Component {
    static properties = { text: { type: String } };
    draw() {
      return h("li", null, this.get("text", ""));
    }
  }

  class List extends Component {
    constructor(props) {
      super(props);
      this.label = "before";
    }
    click() {
      this.label = "after";
      seen = this.node.textContent;
    }
    draw() {
      return h("ul", null, h(Row, { text: this.label }));
    }
  }

  const root = document.createElement("div");
  mount(List, root);
  root.childNodes[0].dispatchEvent({ type: "click" });

  assert.equal(seen, "after");
});

test("nested batches draw once, at the outermost", () => {
  const root = document.createElement("div");
  const view = mount(Panel, root).view;

  counted.draws = 0;
  batch(() => {
    view.a = 5;
    batch(() => {
      view.b = 5;
      view.c = 5;
    });
    view.d = 5;
  });

  assert.equal(counted.draws, 1);
  assert.equal(root.textContent, "5555");
});

test("outside a batch, an assignment still draws where it is made", () => {
  // The contract everything here has always relied on: assigning updates the
  // DOM, now. Only a batch holds that back, and only until it ends.
  const root = document.createElement("div");
  const view = mount(Panel, root).view;

  counted.draws = 0;
  view.a = 9;
  assert.equal(counted.draws, 1);
  assert.equal(root.textContent, "9000");
});

test("a component destroyed during a batch is not drawn afterwards", () => {
  let drewAfterDestroy = false;
  let destroyed = false;

  class Fragile extends Component {
    constructor(props) {
      super(props);
      this.value = 0;
    }
    draw() {
      if (destroyed) drewAfterDestroy = true;
      return h("p", null, String(this.value));
    }
  }

  const root = document.createElement("div");
  const view = mount(Fragile, root).view;

  batch(() => {
    view.value = 1;
    view.destroy();
    destroyed = true;
  });

  assert.equal(drewAfterDestroy, false, "a destroyed component was drawn");
});

test("a draw that assigns more state still settles", () => {
  // A drawing may ask for another. The flush goes round until nothing is owed,
  // rather than over one list.
  class Settling extends Component {
    constructor(props) {
      super(props);
      this.value = 0;
      this.mirror = -1;
    }
    click() {
      this.value = 3;
    }
    draw() {
      if (this.mirror !== this.value) this.mirror = this.value;
      return h("p", null, `${this.value}/${this.mirror}`);
    }
  }

  const root = document.createElement("div");
  mount(Settling, root);
  root.childNodes[0].dispatchEvent({ type: "click" });

  assert.equal(root.textContent, "3/3");
});
