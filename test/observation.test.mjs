// What observation takes for a component's state, and what it does with an
// assignment made while it is telling about another.
//
// Two things used to be wrong here. The runtime's own fields were told apart
// from a page's state by a list of names kept in observe.js — so a controller
// with a `view`, a `root` or a `parent` of its own had that property silently
// left unobserved, and assigning it updated nothing. And an assignment made
// from inside a callback, to a property already being told about, was dropped:
// a controller that settles a value while it redraws left whatever was
// watching showing the value from before.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { Component } from "../src/js/core/runtime/Component.js";
import { bindText } from "../src/js/core/runtime/private/bindText.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { mount } from "../src/js/core/runtime/private/mount.js";
import { observe } from "../src/js/core/runtime/private/observe.js";

/** A compiled `.ib.xml` whose only reading is `{path}`, as codegen emits one. */
function pageOf(path) {
  const page = function () {
    return h("p", null, bindText(this, path));
  };
  page.isMarkup = true;
  return page;
}

// Names that were on the denylist and that the runtime never writes to a
// controller. Each is an ordinary word a page might well use for something of
// its own, and each was silently unobservable.
//
// `view` is not among them: the runtime does write that one — it is how a
// controller reaches what it drew — so it is the runtime's there by rights,
// and now says so rather than being matched by name.
for (const name of ["root", "parent", "children", "node", "controller"]) {
  test(`a controller's own \`${name}\` is state like any other`, () => {
    const controller = { [name]: "before" };

    const root = document.createElement("div");
    mount(pageOf(name), root, {}, controller);
    assert.equal(root.textContent, "before");

    controller[name] = "after";
    assert.equal(root.textContent, "after");
  });
}

test("a drawn component's own `view` is state, and assigning it redraws", () => {
  class Panel extends Component {
    constructor(props) {
      super(props);
      // The page's own word for what it is showing, which happens to collide
      // with one of the runtime's.
      this.view = "list";
    }
    draw() {
      return h("p", null, this.view);
    }
  }

  const root = document.createElement("div");
  const view = mount(Panel, root).view;
  assert.equal(root.textContent, "list");

  view.view = "grid";
  assert.equal(root.textContent, "grid");
});

test("the runtime's own fields are not taken for state", () => {
  // Were `nodes` or `props` observed, assigning one during a draw would
  // schedule another draw from inside that draw, for ever.
  let draws = 0;

  class Counting extends Component {
    draw() {
      draws += 1;
      // Reading them is what would put a watch on them.
      return h("p", null, `${this.nodes.length}/${Object.keys(this.props).length}`);
    }
  }

  const root = document.createElement("div");
  const view = mount(Counting, root).view;
  const after = draws;

  // The runtime assigns both of these on every draw. Nothing should follow.
  view.nodes = view.nodes;
  view.props = { ...view.props };
  assert.equal(draws, after);
});

test("an assignment made while a property is being told about is not dropped", () => {
  const target = { count: 0, doubled: 0 };
  const seen = [];

  // What a controller does when it settles one value from another as it
  // redraws. The second assignment lands while the first is still being told
  // about, which is exactly the case that used to be thrown away.
  observe(target, "count", () => {
    // Assigned, not announced: the accessor observation put on `doubled` tells
    // whoever is watching it. This lands while `count` is still being told
    // about, which is the case that used to be thrown away.
    target.doubled = target.count * 2;
  });
  observe(target, "doubled", () => seen.push(target.doubled));

  target.count = 3;
  assert.deepEqual(seen, [6]);

  target.count = 5;
  assert.deepEqual(seen, [6, 10]);
});

test("a property that assigns itself while being told about settles", () => {
  const target = { value: 0 };
  const seen = [];
  let clamps = 0;

  observe(target, "value", () => {
    seen.push(target.value);
    // A control clamping what it was given, from inside the notification for
    // it. The re-assignment has something new to say and has to be told.
    if (target.value > 10 && clamps++ < 5) target.value = 10;
  });

  target.value = 42;
  assert.deepEqual(seen, [42, 10]);
  assert.equal(target.value, 10);
});

test("the same assignment arriving twice is told about once", () => {
  // A component assigned through its public setter notifies twice over: the
  // accessor observation wraps the setter and tells afterwards, and the setter
  // reaches `Component.set`, which tells as well. That is one assignment.
  class Box extends Component {
    static properties = { label: { type: String } };
    draw() {
      return h("p", null, this.get("label", ""));
    }
  }

  const root = document.createElement("div");
  const view = mount(Box, root, { label: "one" }).view;

  let told = 0;
  observe(view, "label", () => {
    told += 1;
  });

  view.label = "two";
  assert.equal(told, 1);
  assert.equal(root.textContent, "two");
});
