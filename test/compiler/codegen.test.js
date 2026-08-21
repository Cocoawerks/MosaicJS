import { expect, test } from "bun:test";

import { generate } from "../../src/js/core/compiler/codegen.js";
import { takeLineMarkers } from "../../src/js/core/compiler/js.js";
import { parse } from "../../src/js/core/compiler/parser.js";

function compile(src) {
  return generate(parse(src), {
    runtime: "../src/js/runtime/mosaic.js",
    name: "App",
    hash: "test123",
  });
}

/** Parsing is expected to fail. */
function rejects(src) {
  expect(() => parse(src)).toThrow();
}

test("static markup becomes h calls", () => {
  const js = compile('<div styleName="box">Hello</div>');
  expect(js).toContain('h("div", { class: "box" },');
  expect(js).toContain('"Hello"');
});

test("props are kept as initializers", () => {
  expect(compile("<p>hi</p>")).toContain(
    "export default function App(props = {}) {",
  );
});

test("style is scoped and registered", () => {
  const js = compile('<style>.a{color:red}</style><div styleName="a"></div>');
  // The stylesheet constant is namespaced so bundled modules cannot clash.
  expect(js).toContain("const CSS_App =");
  expect(js).toContain('addStyles("test123", CSS_App);');
  expect(js).toContain(".a.test123");
  // The scope is a class, so it joins the ones the markup already gave.
  expect(js).toContain('class: "a test123"');
});

test("the style block may sit anywhere in the file", () => {
  // It is hoisted out of the markup, so its position is a matter of taste.
  const at = (src) => compile(src);
  for (const src of [
    '<div styleName="a">x</div><style>.a{color:red}</style>',
    '<style>.a{color:red}</style><div styleName="a">x</div>',
    "<p>a</p><style>.a{color:red}</style><p>b</p>",
    '<div styleName="a"><style>.a{color:red}</style><p>x</p></div>',
  ]) {
    expect(at(src)).toContain(".a.test123{color:red}");
    // Hoisted, never rendered.
    expect(at(src)).not.toContain('h("style"');
  }

  // One per file, though.
  rejects("<style>.a{c:1}</style><p>x</p><style>.b{c:2}</style>");
});

test("no scope class without styles", () => {
  expect(compile("<div></div>")).not.toContain("test123");
});

test("outlet compiles to a this binding", () => {
  const js = compile('<output outlet="value">0</output>');
  expect(js).toContain("ref: (__el) => { this.value = __el; }");
  expect(js).not.toContain('"outlet"');
});

test("action binds a controller method", () => {
  const js = compile('<button action="increment">+</button>');
  expect(js).toContain("onclick: (...__a) => this.increment(...__a)");
  expect(js).not.toContain('"action"');
});

test("action takes an explicit event", () => {
  expect(compile('<input action="input:onInput">')).toContain(
    "oninput: (...__a) => this.onInput(...__a)",
  );
});

test("action on a component binds its action prop", () => {
  expect(compile('<Card action="save"/>')).toContain(
    "h(Card, { action: (...__a) => this.save(...__a) })",
  );
});

test("a named action on a component is prefixed", () => {
  expect(compile('<Card action="select:onSelect"/>')).toContain(
    "selectAction: (...__a) => this.onSelect(...__a)",
  );
});

test("action binds several events", () => {
  const js = compile('<a action="click:go mouseenter:hover">x</a>');
  expect(js).toContain("onclick: (...__a) => this.go(...__a)");
  expect(js).toContain("onmouseenter: (...__a) => this.hover(...__a)");
});

test("outlet and action coexist with attributes", () => {
  const js = compile(
    '<button styleName="a" outlet="button" action="step">x</button>',
  );
  expect(js).toContain('class: "a"');
  expect(js).toContain("this.button = __el");
  expect(js).toContain("this.step(...__a)");
});

test("only the component declaration uses function", () => {
  // Anything nested would rebind `this` and break outlets and actions.
  const js = compile('<button outlet="b" action="go">x</button>');
  expect(js.match(/function/g)).toHaveLength(1);
});

test("directives must be well formed", () => {
  rejects("<p outlet={x}></p>");
  rejects('<p outlet="not an ident"></p>');
  rejects('<p outlet="a" outlet="b"></p>');
  rejects('<p action=""></p>');
  rejects('<p action="click:a click:b"></p>');
  rejects('<p action="click:not an ident"></p>');
});

test("outlet and action names may not collide", () => {
  // The outlet would overwrite the controller method with a DOM node.
  rejects('<b outlet="go" action="go">x</b>');
  rejects('<b outlet="go"><i action="go">x</i></b>');
});

test("outlet names must be unique", () => {
  rejects('<b outlet="a">x</b><i outlet="a">y</i>');
});

test("view element renders a div with style name as class", () => {
  const js = compile('<View styleName="counter"><b>x</b></View>');
  expect(js).toContain('h("div", { class: "counter" }');
  expect(js).not.toContain("styleName");
});

test("view element is scoped like any dom element", () => {
  expect(
    compile('<style>.a{color:red}</style><View styleName="a"></View>'),
  ).toContain('h("div", { class: "a test123" })');
});

test("view keeps directives and other attributes", () => {
  const js = compile(
    '<View styleName="a" id="root" outlet="box" action="go"></View>',
  );
  expect(js).toContain('class: "a"');
  expect(js).toContain('id: "root"');
  expect(js).toContain("this.box = __el");
  expect(js).toContain("this.go(...__a)");
});

test("view style name accepts a binding", () => {
  expect(compile('<View styleName="card {theme}"></View>')).toContain(
    'class: bindAttr(this, ["card ", { path: "theme" }])',
  );
});

test("style name is the only way to set a class", () => {
  // Native tags use it too; `class` is rejected everywhere.
  const js = compile('<button styleName="step">x</button>');
  expect(js).toContain('h("button", { class: "step" }');
  expect(js).not.toContain("styleName");

  rejects('<button class="step">x</button>');
  rejects('<View class="b"></View>');
  rejects('<img class="b">');
});

test("components keep style name as a prop", () => {
  // A component's props are not DOM attributes, so the name stays as written.
  expect(compile('<Card styleName="a"/>')).toContain(
    'h(Card, { styleName: "a" })',
  );
});

test("component tags emit their imports", () => {
  const js = compile('<View styleName="a"><Counter limit="3"/></View>');
  expect(js).toContain('import Counter from "./Counter.js";');
  expect(js).toContain('h(Counter, { limit: "3" })');
});

test("each component is imported once", () => {
  const js = compile("<Card/><Card/><Badge/>");
  expect(js.match(/import Card from/g)).toHaveLength(1);
  expect(js).toContain('import Badge from "./Badge.js";');
  // <View> is built in and never imported.
  expect(js).not.toContain("import View");
});

test("components are referenced by identifier", () => {
  expect(compile('<Card title="hi"><b>x</b></Card>')).toContain(
    'h(Card, { title: "hi" }',
  );
});

test("components do not get the parent scope attribute", () => {
  expect(
    compile("<style>.a{color:red}</style><Card><i>x</i></Card>"),
  ).toContain("h(Card, null");
});

test("multiple roots wrap in fragment", () => {
  expect(compile("<p>a</p><p>b</p>")).toContain("h(Fragment, null,");
});

test("void elements need no close", () => {
  expect(compile('<div><br><img src="x.png"></div>')).toContain(
    'h("br", null)',
  );
});

test("text binding reads the controller", () => {
  const js = compile("<output>{count}</output>");
  expect(js).toContain('bindText(this, "count")');
  expect(js).toContain("import { h, Fragment, bindText }");
});

test("binding accepts a dotted path", () => {
  expect(compile("<p>{user.name}</p>")).toContain(
    'bindText(this, "user.name")',
  );
});

test("text binding mixes with literal text", () => {
  const js = compile("<p>Hello {name}!</p>");
  expect(js).toContain('"Hello "');
  expect(js).toContain('bindText(this, "name")');
  expect(js).toContain('"!"');
});

test("attribute binding becomes a parts list", () => {
  expect(compile('<div styleName="item {status}"></div>')).toContain(
    'class: bindAttr(this, ["item ", { path: "status" }])',
  );
});

test("attribute with no binding stays a plain string", () => {
  const js = compile('<div styleName="item"></div>');
  expect(js).toContain('class: "item"');
  expect(js).not.toContain("bindAttr");
});

test("binding helpers are imported only when used", () => {
  expect(compile("<p>plain</p>")).toContain("import { h, Fragment } from");
});

test("bindings must be property paths not expressions", () => {
  // The point is a binding to the controller, not an expression language.
  rejects("<p>{count + 1}</p>");
  rejects("<p>{items.filter(x => x)}</p>");
  rejects("<p>{}</p>");
  rejects("<p>{unclosed</p>");
  rejects("<p title={x}>x</p>");
});

test("logic in the markup is still rejected", () => {
  // Markup has no expression language, and no JavaScript of any kind.
  rejects("{#if a}<p>x</p>{/if}");
  rejects("{#each xs as x}<p>x</p>{/each}");
});

test("a <script> block is rejected", () => {
  // A .mib file is markup. JavaScript lives in a module beside it: a
  // controller is that module's default export, and a component is its own
  // file — which is also the only place either can be found.
  expect(() => compile("<script>const n = 1;</script><p>{title}</p>")).toThrow(
    /holds markup, not JavaScript/,
  );
  expect(() =>
    compile("<p>x</p>\n<script>\n  export default class C {}\n</script>"),
  ).toThrow(/move the <script> into a module beside it/);
});

test("a script tag is rejected wherever it appears", () => {
  rejects("<div><script>a</script></div>");
  rejects('<script src="x.js"></script><p>x</p>');
});

test("unclosed tag is an error", () => {
  rejects("<div><span></div>");
});

test("a page with no markup is still a component", () => {
  // What `mosaic init` writes: instructions in a comment and nothing else.
  // It has to compile and mount, so a new app runs before a line is changed.
  const js = compile("<!-- how to write a page -->\n");
  expect(js).toContain("export default function App(props = {}) {");
  expect(js).toContain("return null;");
  expect(js).not.toContain("how to write a page");
});

test("line markers map generated lines back to source", () => {
  const [code, mappings] = takeLineMarkers(
    compile("<div>\n  <p>{count}</p>\n</div>"),
  );
  expect(code).not.toContain("/*@L");
  expect(mappings.length).toBeGreaterThan(0);
});

test("a component's prop is read, an element's attribute is declared", () => {
  // The two are different things. An attribute belongs to this markup, and a
  // binding keeps it up to date afterwards. A component's prop does not — what
  // a Card does with `enabled` is the Card's own — so it is read as the view
  // draws, and reading it is what makes the view draw again when it changes.
  expect(compile('<div><Card enabled="{on}"/></div>')).toContain(
    'bindProp(this, [{ path: "on" }])',
  );
  expect(compile('<div><p title="{on}">x</p></div>')).toContain(
    "bindAttr(this,",
  );
});

test("a bound prop with text around it is that text with the value in it", () => {
  const js = compile('<div><Card title="hello {name}"/></div>');
  expect(js).toContain('bindProp(this, ["hello ", { path: "name" }])');
});

test("each is imported only when it is used", () => {
  const componentOnly = compile('<div><Card enabled="{on}"/></div>');
  expect(componentOnly).toContain("bindProp");
  expect(componentOnly).not.toContain("bindAttr");

  const elementOnly = compile('<div><p title="{on}">x</p></div>');
  expect(elementOnly).toContain("bindAttr");
  expect(elementOnly).not.toContain("bindProp");
});

// --- composing views ---------------------------------------------------------

test("a compiled view says it came from markup", () => {
  // What tells the runtime to give it a scope of its own and hand it the tag's
  // attributes; a function component written by hand carries no such mark and
  // still draws against whoever placed it.
  expect(compile("<p>hi</p>")).toContain("App.isMarkup = true;");
});

test("a capitalised tag is another compiled view, imported by its file name", () => {
  const js = compile("<div><CustomView/></div>");
  expect(js).toContain("import CustomView from");
  expect(js).toContain("h(CustomView, null)");
});

test("and what the tag says is passed to it as props", () => {
  expect(compile('<div><Labelled label="Name"/></div>')).toContain(
    'h(Labelled, { label: "Name" })',
  );
});

// --- surfaces ----------------------------------------------------------------

test("a surface may be the root of a view", () => {
  expect(compile('<PopOver orientation="bottom_center"><p>hi</p></PopOver>'))
    .toContain("h(PopOver,");
  expect(compile('<DialogBox title="Settings"><p>hi</p></DialogBox>')).toContain(
    "h(DialogBox,",
  );
});

test("but not anything else", () => {
  // A surface is placed by the runtime rather than by the markup around it, so
  // nested it would read as something the page does not do.
  expect(() => compile("<div><PopOver/></div>")).toThrow(
    /can only be the root of a .mib file/,
  );
  expect(() => compile("<div><DialogBox/></div>")).toThrow(
    /can only be the root of a .mib file/,
  );
});

test("nor beside another root, where it is not the root either", () => {
  expect(() => compile("<div>first</div><PopOver/>")).toThrow(
    /can only be the root of a .mib file/,
  );
});

test("the refusal says which line, and what to write instead", () => {
  expect(() => compile("<div>\n  <p>a</p>\n  <DialogBox/>\n</div>")).toThrow(
    /line 3/,
  );
  expect(() => compile("<div><PopOver/></div>")).toThrow(/ColourPopOver.mib/);
});

test("a kind of popover that belongs to a control is nested like anything else", () => {
  // Menu and Tooltip extend PopOver, and a menu inside a menu item is how a
  // submenu is written. Only the two surfaces themselves are refused.
  expect(
    compile('<MenuItem text="Share"><Menu><MenuItem text="Someone"/></Menu></MenuItem>'),
  ).toContain("h(Menu,");
  expect(compile("<div><Tooltip/></div>")).toContain("h(Tooltip,");
});

test("a file with a bound prop says it has to redraw", () => {
  // Only such a file does: a binding on this markup's own text or attributes
  // is written straight back into the DOM, and a page that never binds a prop
  // behaves exactly as it did.
  expect(compile('<div><Card enabled="{on}"/></div>')).toContain(
    "App.redraws = true;",
  );
  expect(compile('<div><p title="{on}">{x}</p></div>')).not.toContain(
    "App.redraws",
  );
});

test("a Drawer is a surface too: root only, like a dialog or a popover", () => {
  // It is pinned to the window and pushes the page, so where its markup sits
  // says nothing about where it goes — nesting one would read as something the
  // page does not do.
  expect(compile('<Drawer title="Filters"><p>a</p></Drawer>')).toContain(
    "h(Drawer,",
  );
  expect(() => compile("<div><Drawer/></div>")).toThrow(
    /can only be the root of a .mib file/,
  );
});

test("but a surface may hold whatever it likes", () => {
  // The rule runs one way: a surface cannot be contained, and contains freely.
  const js = compile(
    '<Drawer title="Filters"><CheckBox text="Unread"/><ColorWell/><MyView/></Drawer>',
  );
  expect(js).toContain("h(CheckBox,");
  expect(js).toContain("h(ColorWell,");
  expect(js).toContain("h(MyView,");

  expect(compile('<DialogBox title="x"><MyView/></DialogBox>')).toContain(
    "h(MyView,",
  );
  expect(compile("<PopOver><MyView/></PopOver>")).toContain("h(MyView,");
});

test("and a surface cannot hold another surface either", () => {
  expect(() => compile('<Drawer title="x"><PopOver/></Drawer>')).toThrow(
    /can only be the root of a .mib file/,
  );
  expect(() => compile('<DialogBox title="x"><Drawer/></DialogBox>')).toThrow(
    /can only be the root of a .mib file/,
  );
});

test("minifying collapses the line breaks a text node was written across", () => {
  const src = "<p>one\n   two\n   three</p>";
  expect(compile(src)).toContain('"one\\n   two\\n   three"');

  const minified = generate(parse(src), {
    runtime: "../src/js/runtime/mosaic.js",
    name: "App",
    hash: "test123",
    minify: true,
  });
  expect(minified).toContain('"one two three"');
});
