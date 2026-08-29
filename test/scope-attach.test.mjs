// A composed `.ib.xml` placed as a root of an interface is told it is on screen, and
// so is the interface.
// `mount` tags the interface's controller onto every root node, which is how
// something looking upward finds the interface it is in. A root that is itself a
// composed view has a scope of its own there already — `render` put it there —
// and writing over it lost that view: `attachTree` found the interface's controller
// on the node, told it, and the view whose node it actually was was never told
// at all. Its `awakeFromMib` and `attached` did not run, so a controller that
// reads the document on the way in read nothing.
// Leaving the node to the view raises the other half of it: an interface whose every
// root is a composed view then has its controller on no node, and would never
// be told either. Both are woken here, which is what an interface made of composed
// views needs — `awakeFromMib()` is where a controller's outlets are joined up.
// A controller is woken with `awakeFromMib()` and nothing else; `attached()` is
// a component's hook, not a controller's, and these check it stays unheard.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { mount } from "../src/js/core/runtime/private/mount.js";
import { h } from "../src/js/core/runtime/private/h.js";
import { Fragment } from "../src/js/core/runtime/private/Fragment.js";

/** A compiled `.ib.xml` with a controller beside it, as the compiler emits one. */
function composed(controller) {
  const view = function () {
    return h("div", { class: "composed" });
  };
  view.isMarkup = true;
  view.controller = controller;
  return view;
}

/** An interface whose markup is those views and nothing else, as `main.ib.xml` is. */
function pageOf(...views) {
  const mib = function () {
    return h(Fragment, null, ...views.map((view) => h(view, null)));
  };
  mib.isMarkup = true;
  return mib;
}

/** A controller that records being woken, under `name`. */
function recorder(woken, name) {
  return class {
    awakeFromMib() {
      woken.push(name);
    }
    attached() {
      woken.push(`${name}:attached`);
    }
  };
}

test("a composed view at an interface's root is woken", () => {
  const woken = [];
  const Mib = recorder(woken, "mib");

  const root = document.createElement("div");
  mount(
    pageOf(composed(recorder(woken, "view"))),
    root,
    {},
    new Mib(),
  );

  assert.deepEqual(woken, ["view", "mib"]);
});

test("every composed root is woken, not only the first", () => {
  const woken = [];

  const root = document.createElement("div");
  mount(
    pageOf(
      composed(recorder(woken, "first")),
      composed(recorder(woken, "second")),
    ),
    root,
    {},
    {},
  );

  assert.deepEqual(woken, ["first", "second"]);
});

test("an interface of plain markup is woken once, through its own root", () => {
  const woken = [];
  const mib = function () {
    return h("div", { class: "plain" });
  };
  mib.isMarkup = true;

  const root = document.createElement("div");
  mount(mib, root, {}, new (recorder(woken, "mib"))());

  assert.deepEqual(woken, ["mib"]);
});
