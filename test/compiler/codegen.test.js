import {expect, test} from "bun:test";

import {generate} from "../../src/js/compiler/codegen.js";
import {takeLineMarkers} from "../../src/js/compiler/js.js";
import {parse} from "../../src/js/compiler/parser.js";

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
  expect(compile("<p>hi</p>")).toContain("export default function App(props = {}) {");
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
        '<p>a</p><style>.a{color:red}</style><p>b</p>',
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
    const js = compile('<button styleName="a" outlet="button" action="step">x</button>');
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
  expect(compile('<style>.a{color:red}</style><View styleName="a"></View>')).toContain(
      'h("div", { class: "a test123" })',
  );
});

test("view keeps directives and other attributes", () => {
    const js = compile('<View styleName="a" id="root" outlet="box" action="go"></View>');
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
  expect(compile('<Card styleName="a"/>')).toContain('h(Card, { styleName: "a" })');
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
  expect(compile('<Card title="hi"><b>x</b></Card>')).toContain('h(Card, { title: "hi" }');
});

test("components do not get the parent scope attribute", () => {
  expect(compile("<style>.a{color:red}</style><Card><i>x</i></Card>")).toContain("h(Card, null");
});

test("multiple roots wrap in fragment", () => {
  expect(compile("<p>a</p><p>b</p>")).toContain("h(Fragment, null,");
});

test("void elements need no close", () => {
  expect(compile('<div><br><img src="x.png"></div>')).toContain('h("br", null)');
});

test("text binding reads the controller", () => {
  const js = compile("<output>{count}</output>");
  expect(js).toContain('bindText(this, "count")');
  expect(js).toContain("import { h, Fragment, bindText }");
});

test("binding accepts a dotted path", () => {
  expect(compile("<p>{user.name}</p>")).toContain('bindText(this, "user.name")');
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
    // Markup has no expression language. JavaScript goes in <script>.
  rejects("{#if a}<p>x</p>{/if}");
  rejects("{#each xs as x}<p>x</p>{/each}");
});

test("a script block is hoisted to module scope", () => {
    const js = compile("<script>const n = 1;</script><p>{title}</p>");
    expect(js).toContain("const n = 1;");
    // Above the component, so the markup can reach what it declares.
    expect(js.indexOf("const n = 1;")).toBeLessThan(js.indexOf("export default function App"));
    // It is JavaScript, not markup: nothing is rendered from it.
    expect(js).not.toContain('h("script"');
});

test("a script may declare the page's controller", () => {
    const js = compile("<script>export default class C { m() {} }</script><p>{title}</p>");
    // The module already default-exports its component, so the script's default
    // becomes the controller.
    expect(js).toContain("class C { m() {} }");
    expect(js).toContain("export { C as Controller };");
    expect(js.match(/export default/g)).toHaveLength(1);
});

test("an anonymous controller is given a name to be referred to by", () => {
    const js = compile("<script>export default { count: 0 };</script><p>{count}</p>");
    expect(js).toContain("const __Controller = { count: 0 };");
    expect(js).toContain("export { __Controller as Controller };");
});

test("only the application's page registers its controller", () => {
    const script = "<script>export default class C {}</script><p>x</p>";
    const entry = generate(parse(script), {runtime: "mosaic", name: "Main", hash: "h", entry: true});
    expect(entry).toContain("MosaicApplication.registerController(C);");

    // Any other .mib exports one without claiming to be the application's.
    const other = generate(parse(script), {runtime: "mosaic", name: "Card", hash: "h"});
    expect(other).toContain("export { C as Controller };");
    expect(other).not.toContain("registerController");
    expect(other).not.toContain("MosaicApplication");
});

test("a component the script declares is not imported", () => {
    // It is this file's own — importing it would look for a module that was
    // never meant to exist.
    const js = compile("<script>class Counter { draw() {} }</script><div><Counter/></div>");
    expect(js).not.toContain('import Counter from');
    expect(js).toContain("h(Counter, null)");
});

test("a component the script imports is not imported twice", () => {
    const js = compile(
        '<script>import Card from "./elsewhere/Card.js";</script><div><Card/></div>',
    );
    expect(js.match(/Card from/g)).toHaveLength(1);
    expect(js).toContain('import Card from "./elsewhere/Card.js";');
});

test("a runtime name is still not imported for a script that declares it", () => {
    // Shadowing the runtime's name is the script's business.
    const js = compile("<script>class Component {}\nclass C extends Component {}</script><p>x</p>");
    expect(js).toContain("class Component {}");
});

test("a component the script does not name is still imported", () => {
    const js = compile("<script>const n = 1;</script><div><Badge/></div>");
    expect(js).toContain('import Badge from "./Badge.js";');
});

test("indentation does not decide what is module scope", () => {
    // A block's contents sit inside a tag, so how far they are indented is
    // formatting. Uneven indentation must not hide a declaration either.
    const draw = "class C { draw() { return <Card/>; } }";
    for (const script of [
        `import Card from "./a.js";\n${draw}`,
        `  import Card from "./a.js";\n  ${draw}`,
        `  import Card from "./a.js";\n ${draw}`,      // uneven
        `\timport Card from "./a.js";\n\t${draw}`,
    ]) {
        const js = compile(`<script>\n${script}\n</script><p>x</p>`);
        expect(js).toContain('import Card from "./a.js";');
        expect(js).not.toContain('"./Card.js"');
    }
});

test("a brace in a string or comment is text, not structure", () => {
    const draw = "class C { draw() { return <Card/>; } }";
    const js = compile(
        `<script>\nconst s = "{";\n// {\nimport Card from "./a.js";\n${draw}\n</script><p>x</p>`,
    );
    expect(js).toContain('import Card from "./a.js";');
    expect(js).not.toContain('"./Card.js"');
});

test("a declaration inside a function is not module scope", () => {
    // `Card` is local to `make`, and naming a tag after it would not reach it.
    const js = compile("<script>function make() {\n  class Card {}\n}</script><div><Card/></div>");
    expect(js).toContain('import Card from "./Card.js";');
});

test("a component the script draws must be imported by the script", () => {
    // A <script> is JavaScript, and says what it depends on the way any module
    // does. Failing here beats an "X is not defined" when the page is opened.
    expect(() => compile("<script>class C { draw() { return <Card/>; } }</script><p>x</p>")).toThrow(
        /<Card\/> is drawn in the <script> but nothing imports it/,
    );

    // Its own import satisfies it, and is not duplicated.
    const own = compile(
        '<script>import Card from "./Card.js";\nclass C { draw() { return <Card/>; } }</script><p>x</p>',
    );
    expect(own.match(/Card from/g)).toHaveLength(1);

    // So does the markup's, since that import is in the same module scope.
    const shared = compile("<script>class C { draw() { return <Card/>; } }</script><Card/>");
    expect(shared).toContain('import Card from "./Card.js";');
});

test("a runtime name the script uses is the script's to import", () => {
    // `Component` is not added on the script's behalf.
    const js = compile("<script>class C extends Component {}</script><p>x</p>");
    // The runtime import carries what the markup needs, and nothing more.
    expect(js.split("\n")[0]).toBe('import { h, Fragment } from "../src/js/runtime/mosaic.js";');
});

test("jsx in a script is transformed and scoped like the markup", () => {
    const js = compile(
        "<style>.a{color:red}</style>" +
        "<script>class C { draw() { return <View styleName=\"a\"/>; } }</script><p>x</p>",
    );
    expect(js).toContain('h("div", { class: "a test123" })');
});

test("one script block per file", () => {
    rejects("<script>a</script><p>x</p><script>b</script>");
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
  const [code, mappings] = takeLineMarkers(compile("<div>\n  <p>{count}</p>\n</div>"));
  expect(code).not.toContain("/*@L");
  expect(mappings.length).toBeGreaterThan(0);
});
