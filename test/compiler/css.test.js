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

test("a prefix raises what a rule outscores without changing what it matches", () => {
    // How a theme is emitted: unscoped, so its selectors mean what they say,
    // and prefixed so they outscore the scope class a component's own
    // stylesheet carries.
    expect(scope(".v-Button{color:red}", "", ":root")).toBe(":root .v-Button{color:red}");
    expect(scope(".a .b{color:red}", "", ":root")).toBe(":root .a .b{color:red}");

    // The theme's own variables block is already rooted, and stays as it was.
    expect(scope(":root{--a:1}", "", ":root")).toBe(":root{--a:1}");
    expect(scope(":root .x{color:red}", "", ":root")).toBe(":root .x{color:red}");

    // Inside a nested at-rule too.
    expect(scope("@media (min-width:1px){.y{color:red}}", "", ":root"))
        .toBe("@media (min-width:1px){:root .y{color:red}}");

    // With no prefix it is what it always was.
    expect(scope(".v-Button{color:red}", "")).toBe(".v-Button{color:red}");
});

test("minifying drops the comments a stylesheet ships with", () => {
    // A stylesheet rides into the bundle as a string, where the bundler's own
    // minifier never sees it. This is the only thing that takes its prose out.
    const sheet = `/* what this is for */
.a { color: red; /* and why */ }
/* a section
   over two lines */
.b { color: blue; }
`;
    const minified = scope(sheet, ".h", null, {minify: true});
    expect(minified).not.toContain("/*");
    expect(minified).not.toContain("what this is for");
    expect(minified).toContain(".a.h{color: red;}");
    expect(minified).toContain(".b.h{color: blue;}");

    // Left alone without the flag: a compiled module stays readable.
    expect(scope(sheet, ".h")).toContain("what this is for");
});

test("minifying leaves a string that looks like a comment alone", () => {
    const sheet = `.a::after { content: "/* not a comment */"; }`;
    expect(scope(sheet, ".h", null, {minify: true}))
        .toBe(`.a.h::after{content: "/* not a comment */";}`);
});

test("a comment between tokens does not become whitespace when dropped", () => {
    // A comment separates tokens without standing between them, so `.a/**/.b`
    // is one compound and stays one — turning it into `.a .b` would change
    // which elements the rule matches.
    expect(scope(".a/* x */.b{color:red}", "", null, {minify: true}))
        .toBe(".a.b{color:red}");
    expect(scope(".a /* x */ .b{color:red}", "", null, {minify: true}))
        .toBe(".a  .b{color:red}");
});

test("minifying a theme keeps the prefix it is emitted with", () => {
    const sheet = `/* the theme's own note */\n:root { --a: 1; }\n.v-Button { color: red; }\n`;
    const minified = scope(sheet, "", ":root", {minify: true});
    expect(minified).not.toContain("/*");
    expect(minified).toContain(":root{--a: 1;}");
    expect(minified).toContain(":root .v-Button{color: red;}");
});

test("minifying drops the blank lines a stylesheet is written with", () => {
    // The sheets space their rules apart, and taking the comments out leaves
    // the lines those stood on behind — a blank line per rule and per note.
    const sheet = `/* a note */

.a { color: red; }


/* another */
.b { color: blue; }
`;
    const minified = scope(sheet, ".h", null, {minify: true});
    expect(minified).toBe(".a.h{color: red;}\n.b.h{color: blue;}\n");
    // Trailing newline aside — that is a line ending, not an empty line.
    expect(minified.trimEnd().split("\n").filter((l) => l.trim() === "")).toEqual([]);

    // Untouched without the flag.
    expect(scope(sheet, ".h")).toContain("\n\n");
});

test("minifying keeps a newline that is doing a job", () => {
    // A newline between two compounds is a descendant combinator: `.c\n.d`
    // matches what `.c .d` matches. Only lines holding nothing come out.
    expect(scope(".c\n.d{color:red}", ".h", null, {minify: true}))
        .toBe(".c\n.d.h{color:red}");

    // Including one inside a string, which is passed over whole.
    expect(scope('.x::after{content:"a\nb"}', ".h", null, {minify: true}))
        .toBe('.x.h::after{content:"a\nb"}');
});
