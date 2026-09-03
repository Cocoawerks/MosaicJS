// A mounted component whose root is another component.
//
// The node standing for the one is the node standing for the other, and only
// one of them can be tagged on it. `mount` used to write the outer component
// over whatever `render` had left there — so the tag named the outer component
// while the vnode in that place named the inner one. A patch that finds those
// two disagreeing cannot reuse what is there, so every redraw of the outer
// component built the inner one again from nothing.
//
// What that costs is everything the inner component was holding. A Wizard draws
// a dialog and nothing else: telling the dialog to open and then redrawing the
// wizard brought back a dialog that had never been told, so the page mask went
// up over a dialog that stayed closed.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { batch } from "../src/js/core/runtime/private/batch.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/** Stands in for a Dialog: state of its own that a rebuild would lose. */
class Inner extends Component {
  constructor(props) {
    super(props);
    Inner.built += 1;
    this.open = false;
  }
  draw() {
    return h("dialog", { class: this.open ? "is-open" : "" }, "content");
  }
}
Inner.built = 0;

/** Stands in for a WizardView: it draws the inner component and nothing else. */
class Outer extends Component {
  constructor(props) {
    super(props);
    this.label = "first";
  }
  draw() {
    return h(Inner, { ref: (v) => (this.inner = v), title: this.label });
  }
}

test("the inner component is what the shared node is tagged with", () => {
  Inner.built = 0;
  const root = document.createElement("div");
  const outer = mount(Outer, root).view;

  const node = outer.nodes[0];
  assert.equal(node.__ibView, outer.inner, "the node names the outer component");
  assert.equal(node.__ibType, Inner);
});

test("redrawing the outer component keeps the inner one's instance", () => {
  Inner.built = 0;
  const root = document.createElement("div");
  const outer = mount(Outer, root).view;
  const inner = outer.inner;
  assert.equal(Inner.built, 1);

  outer.label = "second";

  assert.equal(Inner.built, 1, "the inner component was built again");
  assert.equal(outer.inner, inner, "the ref points at a different instance");
});

test("state set on the inner component survives the outer one redrawing", () => {
  Inner.built = 0;
  const root = document.createElement("div");
  const outer = mount(Outer, root).view;

  outer.inner.open = true;
  assert.match(root.childNodes[0].getAttribute("class"), /is-open/);

  outer.label = "second";
  assert.match(
    root.childNodes[0].getAttribute("class"),
    /is-open/,
    "the inner component came back closed",
  );
});

test("and survives when both are redrawn together in one batch", () => {
  // The wizard's own shape: one press mounts the view, tells the dialog to
  // open, and asks the view to redraw — so both are owed a drawing when the
  // handler ends. The outer one is drawn first, and used to take the inner
  // one down with it before the inner one's own drawing ever ran.
  Inner.built = 0;
  const root = document.createElement("div");
  const outer = mount(Outer, root).view;

  batch(() => {
    outer.label = "second";
    outer.inner.open = true;
  });

  assert.equal(Inner.built, 1, "the inner component was built again");
  assert.match(
    root.childNodes[0].getAttribute("class"),
    /is-open/,
    "the inner component came back closed",
  );
});
