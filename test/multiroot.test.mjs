// A view with more than one root, redrawn.
//
// There was no single node to patch against, so every root was thrown away and
// built again — and with them went everything the DOM was holding: focus, the
// scroll position, a press in progress, and the instance of every component
// beneath them. A component that kept state lost it whenever anything above it
// changed. The roots are a list, and they line up one for one with what was
// drawn, so they are now reconciled the way a child list is.
//
// Also here: the events a component handles, which are worked out once per
// class rather than by asking after each of the sixty-odd names on every node
// of every draw.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { Fragment } from "../src/js/core/runtime/private/Fragment.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";

/** A component whose drawing is three roots, the middle one showing `label`. */
class Triple extends Component {
  constructor(props) {
    super(props);
    this.label = "one";
  }
  draw() {
    return h(
      Fragment,
      null,
      h("header", null, "fixed"),
      h("p", null, this.label),
      h("footer", null, "fixed"),
    );
  }
}

test("a multi-root drawing patches its roots rather than rebuilding them", () => {
  const root = document.createElement("div");
  const view = mount(Triple, root).view;

  assert.equal(view.nodes.length, 3);
  const [header, paragraph, footer] = view.nodes;
  assert.equal(paragraph.textContent, "one");

  view.label = "two";

  assert.equal(paragraph.textContent, "two");
  // The same nodes, not replacements wearing the same tags. This is the whole
  // point: a node that survives keeps what the DOM was holding for it.
  assert.equal(view.nodes[0], header);
  assert.equal(view.nodes[1], paragraph);
  assert.equal(view.nodes[2], footer);
});

test("the roots stay where they are among their siblings", () => {
  // The roots of a multi-root view are a slice of their parent's children
  // rather than all of them, so a patch must not treat the parent's first
  // child as the place they start.
  const root = document.createElement("div");
  const before = document.createElement("span");
  before.textContent = "before";
  root.appendChild(before);

  const host = document.createElement("div");
  root.appendChild(host);

  const view = mount(Triple, host).view;
  view.label = "two";

  assert.equal(host.childNodes.length, 3);
  assert.equal(host.childNodes[0].tagName, "header");
  assert.equal(host.childNodes[1].textContent, "two");
  assert.equal(host.childNodes[2].tagName, "footer");
  assert.equal(root.childNodes[0], before);
});

test("a component under a multi-root drawing keeps its instance and its state", () => {
  // What rebuilding cost that nothing else could give back. The child is
  // constructed once; a rebuild would construct another and the count it was
  // holding would go with the old one.
  let built = 0;

  class Tally extends Component {
    constructor(props) {
      super(props);
      built += 1;
      this.count = 0;
    }
    draw() {
      return h("output", null, String(this.count));
    }
  }

  class Mib extends Component {
    constructor(props) {
      super(props);
      this.heading = "first";
    }
    draw() {
      return h(Fragment, null, h("h1", null, this.heading), h(Tally, null));
    }
  }

  const root = document.createElement("div");
  const mib = mount(Mib, root).view;

  const tally = mib.nodes[1].__ibView;
  assert.equal(built, 1);

  tally.count = 7;
  assert.equal(mib.nodes[1].textContent, "7");

  // A redraw of the interface above it, which has nothing to do with the child.
  mib.heading = "second";

  assert.equal(built, 1, "the child was constructed again");
  assert.equal(mib.nodes[1].__ibView, tally);
  assert.equal(mib.nodes[1].textContent, "7", "the child lost its state");
});

test("roots gained and lost are added and removed in place", () => {
  class Growing extends Component {
    constructor(props) {
      super(props);
      this.rows = 2;
    }
    draw() {
      return Array.from({ length: this.rows }, (_, i) =>
        h("p", null, `row ${i}`),
      );
    }
  }

  const root = document.createElement("div");
  const view = mount(Growing, root).view;
  assert.equal(root.childNodes.length, 2);
  const first = view.nodes[0];

  view.rows = 4;
  assert.equal(root.childNodes.length, 4);
  assert.deepEqual(
    [...root.childNodes].map((n) => n.textContent),
    ["row 0", "row 1", "row 2", "row 3"],
  );
  assert.equal(view.nodes[0], first, "an untouched root was replaced");

  view.rows = 1;
  assert.equal(root.childNodes.length, 1);
  assert.equal(root.childNodes[0].textContent, "row 0");
  assert.equal(view.nodes.length, 1);
});

test("a root that changes shape is replaced, and the rest are left alone", () => {
  class Switching extends Component {
    constructor(props) {
      super(props);
      this.heading = false;
    }
    draw() {
      return h(
        Fragment,
        null,
        this.heading ? h("h1", null, "title") : h("p", null, "title"),
        h("footer", null, "fixed"),
      );
    }
  }

  const root = document.createElement("div");
  const view = mount(Switching, root).view;
  const footer = view.nodes[1];
  assert.equal(view.nodes[0].tagName, "p");

  view.heading = true;

  assert.equal(view.nodes[0].tagName, "h1");
  assert.equal(view.nodes[1], footer);
  assert.equal(root.childNodes.length, 2);
  assert.equal(root.childNodes[0].tagName, "h1");
});

test("a redraw watches what the branch it took reads", () => {
  // A drawing names nothing it depends on. A redraw that takes a branch the
  // first draw did not reads a property nobody is watching — and assigning it
  // afterwards used to update nothing at all.
  class Branching extends Component {
    constructor(props) {
      super(props);
      this.detailed = false;
      this.detail = "hidden";
    }
    draw() {
      return h(Fragment, null, h("p", null, this.detailed ? this.detail : "-"));
    }
  }

  const root = document.createElement("div");
  const view = mount(Branching, root).view;
  assert.equal(root.textContent, "-");

  // `detail` was never read by the first drawing, so nothing watched it.
  view.detailed = true;
  assert.equal(root.textContent, "hidden");

  // It has been read now, and assigning it has to come through.
  view.detail = "shown";
  assert.equal(root.textContent, "shown");
});

test("a handler written as a class field is wired up", () => {
  // Which events a class handles is worked out once and kept against the
  // prototype — so a handler that is not on the prototype but on the instance,
  // as a class field is, has to be found separately or it is never bound.
  let clicks = 0;

  class Pressable extends Component {
    click = () => {
      clicks += 1;
    };
    draw() {
      return h("button", null, "press");
    }
  }

  const root = document.createElement("div");
  mount(Pressable, root);
  root.childNodes[0].dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);
});

test("a handler on the prototype is bound once, not once per name", () => {
  let clicks = 0;

  class Pressable extends Component {
    constructor(props) {
      super(props);
      this.label = "press";
    }
    click() {
      clicks += 1;
    }
    draw() {
      return h("button", null, this.label);
    }
  }

  const root = document.createElement("div");
  const view = mount(Pressable, root).view;
  const button = root.childNodes[0];

  // Redrawn several times: a node that survives keeps the listener it has, so
  // the handler must not accumulate.
  view.label = "again";
  view.label = "and again";

  assert.equal(view.nodes[0], button);
  button.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);
});
