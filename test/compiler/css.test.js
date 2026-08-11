import { expect, test } from "bun:test";

import { scope } from "../../src/js/compiler/css.js";

test("scopes last compound", () => {
  expect(scope(".box span{color:red}", "data-mosaic-x")).toBe(
    ".box span[data-mosaic-x]{color:red}",
  );
});

test("keeps pseudo element last", () => {
  expect(scope("a::before{content:''}", "data-mosaic-x")).toBe(
    "a[data-mosaic-x]::before{content:''}",
  );
});

test("recurses into media", () => {
  expect(scope("@media (min-width:1px){.a{color:red}}", "data-mosaic-x")).toBe(
    "@media (min-width:1px){.a[data-mosaic-x]{color:red}}",
  );
});

test("comments are not selectors", () => {
  expect(scope("/* a note */\n.a{color:red}", "data-mosaic-x")).toBe(
    "/* a note */\n.a[data-mosaic-x]{color:red}",
  );
});

test("comment between rules survives", () => {
  expect(scope(".a{color:red}/* mid */.b{color:blue}", "data-mosaic-x")).toBe(
    ".a[data-mosaic-x]{color:red}/* mid */.b[data-mosaic-x]{color:blue}",
  );
});

test("leaves keyframes alone", () => {
  expect(scope("@keyframes spin{from{opacity:0}}", "data-mosaic-x")).toBe(
    "@keyframes spin{from{opacity:0}}",
  );
});

test("global escape hatch", () => {
  expect(scope(":global(body){margin:0}", "data-mosaic-x")).toBe("body{margin:0}");
});

test("global on a descendant scopes only the container", () => {
  // The pattern for controller-built children: the container is scoped, the
  // rows are not.
  expect(scope(".todo :global(.item){color:red}", "data-mosaic-x")).toBe(
    ".todo[data-mosaic-x] .item{color:red}",
  );
});

test("global descendant keeps combinators", () => {
  expect(scope(".a > :global(.b){color:red}", "data-mosaic-x")).toBe(
    ".a[data-mosaic-x] > .b{color:red}",
  );
});

test("global container still scopes a local descendant", () => {
  expect(scope(":global(.a) .b{color:red}", "data-mosaic-x")).toBe(
    ".a .b[data-mosaic-x]{color:red}",
  );
});
