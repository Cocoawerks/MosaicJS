// A composed `.ib.xml` placed as a root of a page is told it is on screen, and
// so is the page.
// `mount` tags the page's controller onto every root node, which is how
// something looking upward finds the page it is in. A root that is itself a
// composed view has a scope of its own there already — `render` put it there —
// and writing over it lost that view: `attachTree` found the page's controller
// on the node, told it, and the view whose node it actually was was never told
// at all. Its `awakeFromMib` and `attached` did not run, so a controller that
// reads the document on the way in read nothing.
// Leaving the node to the view raises the other half of it: a page whose every
// root is a composed view then has its controller on no node, and would never
// be told either. Both are woken here, which is what a page made of composed
// views needs — `awakeFromMib()` is where a controller's outlets are joined up.
// A controller is woken with `awakeFromMib()` and nothing else; `attached()` is
// a component's hook, not a controller's, and these check it stays unheard.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

import { mount } from "../src/js/core/runtime/mount.js";
import { h } from "../src/js/core/runtime/h.js";
import { Fragment } from "../src/js/core/runtime/Fragment.js";

/** A compiled `.ib.xml` with a controller beside it, as the compiler emits one. */
function composed(controller) {
  const view = function () {
    return h("div", { class: "composed" });
  };
  view.isMarkup = true;
  view.controller = controller;
  return view;
}

/** A page whose markup is those views and nothing else, as `main.ib.xml` is. */
function pageOf(...views) {
  const page = function () {
    return h(Fragment, null, ...views.map((view) => h(view, null)));
  };
  page.isMarkup = true;
  return page;
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

test("a composed view at a page's root is woken", () => {
  const woken = [];
  const Page = recorder(woken, "page");

  const root = document.createElement("div");
  mount(
    pageOf(composed(recorder(woken, "view"))),
    root,
    {},
    new Page(),
  );

  assert.deepEqual(woken, ["view", "page"]);
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

test("a page of plain markup is woken once, through its own root", () => {
  const woken = [];
  const page = function () {
    return h("div", { class: "plain" });
  };
  page.isMarkup = true;

  const root = document.createElement("div");
  mount(page, root, {}, new (recorder(woken, "page"))());

  assert.deepEqual(woken, ["page"]);
});
