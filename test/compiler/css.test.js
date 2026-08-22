import { expect, test } from "bun:test";

import { scope } from "../../src/js/core/compiler/css.js";

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
  expect(scope(".v-Button{color:red}", "", ":root")).toBe(
    ":root .v-Button{color:red}",
  );
  expect(scope(".a .b{color:red}", "", ":root")).toBe(":root .a .b{color:red}");

  // The theme's own variables block is already rooted, and stays as it was.
  expect(scope(":root{--a:1}", "", ":root")).toBe(":root{--a:1}");
  expect(scope(":root .x{color:red}", "", ":root")).toBe(":root .x{color:red}");

  // Inside a nested at-rule too.
  expect(scope("@media (min-width:1px){.y{color:red}}", "", ":root")).toBe(
    "@media (min-width:1px){:root .y{color:red}}",
  );

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
  const minified = scope(sheet, ".h", null, { minify: true });
  expect(minified).not.toContain("/*");
  expect(minified).not.toContain("what this is for");
  expect(minified).toContain(".a.h{color:red;}");
  expect(minified).toContain(".b.h{color:blue;}");

  // Left alone without the flag: a compiled module stays readable.
  expect(scope(sheet, ".h")).toContain("what this is for");
});

test("minifying leaves a string that looks like a comment alone", () => {
  const sheet = `.a::after { content:"/* not a comment */"; }`;
  expect(scope(sheet, ".h", null, { minify: true })).toBe(
    `.a.h::after{content:"/* not a comment */";}`,
  );
});

test("a comment between tokens does not become whitespace when dropped", () => {
  // A comment separates tokens without standing between them, so `.a/**/.b`
  // is one compound and stays one — turning it into `.a .b` would change
  // which elements the rule matches.
  expect(scope(".a/* x */.b{color:red}", "", null, { minify: true })).toBe(
    ".a.b{color:red}",
  );
  // The spaces that stood either side of it are a combinator, and stay one.
  expect(scope(".a /* x */ .b{color:red}", "", null, { minify: true })).toBe(
    ".a .b{color:red}",
  );
});

test("minifying a theme keeps the prefix it is emitted with", () => {
  const sheet = `/* the theme's own note */\n:root { --a: 1; }\n.v-Button { color: red; }\n`;
  const minified = scope(sheet, "", ":root", { minify: true });
  expect(minified).not.toContain("/*");
  expect(minified).toContain(":root{--a:1;}");
  expect(minified).toContain(":root .v-Button{color:red;}");
});

test("minifying puts the whole sheet on one line", () => {
  // The sheets space their rules apart and write a declaration to a line.
  // A string's newlines are the one whitespace the bundler cannot reach.
  const sheet = `/* a note */

.a { color: red; }


/* another */
.b { color: blue; }
`;
  const minified = scope(sheet, ".h", null, { minify: true });
  expect(minified).toBe(".a.h{color:red;}.b.h{color:blue;}");
  expect(minified).not.toContain("\n");

  // Untouched without the flag.
  expect(scope(sheet, ".h")).toContain("\n\n");
});

test("minifying leaves a space where whitespace was doing a job", () => {
  // Whitespace between two compounds is a descendant combinator: `.c\n.d`
  // matches what `.c .d` matches, so the newline becomes the space it was.
  expect(scope(".c\n.d{color:red}", ".h", null, { minify: true })).toBe(
    ".c .d.h{color:red}",
  );

  // A newline inside a string is content, and is passed over whole.
  expect(scope('.x::after{content:"a\nb"}', ".h", null, { minify: true })).toBe(
    '.x.h::after{content:"a\nb"}',
  );
});

test("minifying takes out the whitespace that carries nothing", () => {
  const sheet = `
.a , .b > .c + .d ~ .e {
  margin : 0 auto ;
  color : red !important ;
}
`;
  expect(scope(sheet, ".h", null, { minify: true })).toBe(
    ".a.h,.b>.c+.d~.e.h{margin:0 auto;color:red!important;}",
  );
});

test("minifying keeps the whitespace that is a token", () => {
  // A descendant combinator, the parts of a shorthand, and the spaces `calc()`
  // requires around its operators.
  expect(
    scope(".a .b{padding:1px 2px 3px 4px;width:calc(100% - 2px)}", "", null, {
      minify: true,
    }),
  ).toBe(".a .b{padding:1px 2px 3px 4px;width:calc(100% - 2px)}");

  // `.a :hover` is a descendant of `.a`; `.a:hover` is `.a` itself.
  expect(scope(".a :hover{color:red}", "", null, { minify: true })).toBe(
    ".a :hover{color:red}",
  );
});

test("minifying a media query squeezes its features but not a calc in one", () => {
  const sheet = `@media screen and (min-width : 40em) {\n  .a { color : red; }\n}`;
  expect(scope(sheet, ".h", null, { minify: true })).toBe(
    "@media screen and (min-width:40em){.a.h{color:red;}}",
  );

  expect(
    scope("@media (min-width: calc(10px + 2px)){.a{color:red}}", "", null, {
      minify: true,
    }),
  ).toBe("@media (min-width:calc(10px + 2px)){.a{color:red}}");
});

test("minifying leaves a selector inside :not() alone", () => {
  // The same characters mean different things in a query and in a selector,
  // so `:not(...)` is not squeezed the way `@media (...)` is.
  expect(scope(":not(.a :hover){color:red}", "", null, { minify: true })).toBe(
    ":not(.a :hover){color:red}",
  );
});

test("minifying squeezes an attribute selector but not grid line names", () => {
  expect(
    scope('a[ type = "text" ]{color:red}', "", null, { minify: true }),
  ).toBe('a[type="text"]{color:red}');
  // In a value the brackets hold names that a space separates.
  expect(
    scope(".a{grid-template-columns:[full-start] 1fr [full-end]}", "", null, {
      minify: true,
    }),
  ).toBe(".a{grid-template-columns:[full-start] 1fr [full-end]}");
});

// --- a component named where a class goes ------------------------------------

/** What each component draws its root with, as the build reads off the source. */
const wears = (name) =>
  ({ ComboBox: "v-ComboBox", DialogBox: "v-Dialog", Button: "v-Button" })[
    name
  ] ?? null;

test("a component's name stands for the class it wears", () => {
  // A sheet says what it means — the name the markup places it by — rather
  // than having to know that a combo box draws itself as `.v-ComboBox`.
  //
  // And naming one moves the anchor to the front: the combo box drew its own
  // root and gave it its own hash, so a rule cannot ask that root to carry
  // this page's. Anchored at `.mydialog` the rule still reaches nothing this
  // page did not place.
  expect(
    scope(".mydialog ComboBox{width:160px}", ".h", null, { component: wears }),
  ).toBe(".mydialog.h .v-ComboBox{width:160px}");

  // Written as the class instead, it is scoped as it always was — which is
  // why every sheet in the framework goes on meaning what it meant.
  expect(
    scope(".mydialog .v-ComboBox{width:160px}", ".h", null, {
      component: wears,
    }),
  ).toBe(".mydialog .v-ComboBox.h{width:160px}");
});

test("and the class it wears is not always its name", () => {
  // A DialogBox draws `v-Dialog`, so a convention would have been wrong. The
  // component declares it and the build reads what it declared.
  expect(scope("DialogBox{color:red}", ".h", null, { component: wears })).toBe(
    ".v-Dialog.h{color:red}",
  );
});

test("whatever follows the name is left as it is", () => {
  const at = (sel) =>
    scope(sel, ".h", null, { component: wears }).split("{")[0];

  expect(at(".a ComboBox.popup:hover{x:y}")).toBe(
    ".a.h .v-ComboBox.popup:hover",
  );
  expect(at(".a > Button{x:y}")).toBe(".a.h > .v-Button");
  expect(at(".a Button, .a ComboBox{x:y}")).toBe(
    ".a.h .v-Button, .a.h .v-ComboBox",
  );
});

test("a capital is what says it is a component, since a tag has none", () => {
  const at = (sel) =>
    scope(sel, ".h", null, { component: wears }).split("{")[0];

  // Neither names a component, so neither moves the anchor either.
  expect(at(".a div{x:y}")).toBe(".a div.h", "a tag is a tag");
  expect(at(".a .Button{x:y}")).toBe(".a .Button.h", "and a class is a class");
});

test("a name nothing answers to is left alone", () => {
  // A sheet naming a component this build never compiled is not rewritten into
  // a class that would match nothing — it is left to fail as it was written.
  expect(
    scope(".a Whatever{x:y}", ".h", null, { component: wears }).split("{")[0],
  ).toBe(".a Whatever.h");
});

test("a component named inside :global() is still its class", () => {
  // The name is how a sheet refers to the component either way; whether the
  // rule is scoped is a separate question.
  expect(
    scope(":global(DialogBox) .note{x:y}", ".h", null, { component: wears }),
  ).toBe(".v-Dialog .note.h{x:y}");
});

test("with no resolver, a name is left as written", () => {
  // Which is what every caller that is not compiling a `.mib` does.
  expect(scope(".a ComboBox{x:y}", ".h").split("{")[0]).toBe(".a ComboBox.h");
});
