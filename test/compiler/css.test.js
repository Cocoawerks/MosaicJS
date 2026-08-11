import {expect, test} from "bun:test";

import {scope} from "../../src/js/core/compiler/css.js";

test("scopes last compound", () => {
    expect(scope(".box span{color:red}", ".x1y2z3q")).toBe(
        ".box span.x1y2z3q{color:red}",
  );
});

test("keeps pseudo element last", () => {
    expect(scope("a::before{content:''}", ".x1y2z3q")).toBe(
        "a.x1y2z3q::before{content:''}",
  );
});

test("recurses into media", () => {
    expect(scope("@media (min-width:1px){.a{color:red}}", ".x1y2z3q")).toBe(
        "@media (min-width:1px){.a.x1y2z3q{color:red}}",
  );
});

test("comments are not selectors", () => {
    expect(scope("/* a note */\n.a{color:red}", ".x1y2z3q")).toBe(
        "/* a note */\n.a.x1y2z3q{color:red}",
  );
});

test("comment between rules survives", () => {
    expect(scope(".a{color:red}/* mid */.b{color:blue}", ".x1y2z3q")).toBe(
        ".a.x1y2z3q{color:red}/* mid */.b.x1y2z3q{color:blue}",
  );
});

test("leaves keyframes alone", () => {
    expect(scope("@keyframes spin{from{opacity:0}}", ".x1y2z3q")).toBe(
    "@keyframes spin{from{opacity:0}}",
  );
});

test("global escape hatch", () => {
    expect(scope(":global(body){margin:0}", ".x1y2z3q")).toBe("body{margin:0}");
});

test("global on a descendant scopes only the container", () => {
  // The pattern for controller-built children: the container is scoped, the
  // rows are not.
    expect(scope(".todo :global(.item){color:red}", ".x1y2z3q")).toBe(
        ".todo.x1y2z3q .item{color:red}",
  );
});

test("global descendant keeps combinators", () => {
    expect(scope(".a > :global(.b){color:red}", ".x1y2z3q")).toBe(
        ".a.x1y2z3q > .b{color:red}",
  );
});

test("global container still scopes a local descendant", () => {
    expect(scope(":global(.a) .b{color:red}", ".x1y2z3q")).toBe(
        ".a .b.x1y2z3q{color:red}",
  );
});
