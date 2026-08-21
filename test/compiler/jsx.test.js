import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { lineMarker, takeLineMarkers } from "../../src/js/core/compiler/js.js";
import {
  ensureRuntimeNames,
  inlineCssImports,
  inlineImageImports,
  inlineSvgImports,
  transform,
} from "../../src/js/core/compiler/jsx.js";

/** A scratch directory of its own, so tests never race over one shared path. */
const dirs = [];

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files ?? {})) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Tests read the code without the source-map markers. */
const clean = (src) => takeLineMarkers(transform(src, null))[0];
/** With a scope, elements are stamped and stylesheets are constrained. */
const scoped = (src) => takeLineMarkers(transform(src, "scopex"))[0];

test("runtime import is merged into an existing one", () => {
  const code =
    'import { Component } from "../mosaic.js";\nclass A extends Component {}';
  const out = ensureRuntimeNames(code, "../mosaic.js", ["h", "Fragment"]);
  expect(
    out.startsWith('import { h, Fragment, Component } from "../mosaic.js";'),
  ).toBe(true);
  expect(out.match(/import/g)).toHaveLength(1);
});

test("a source relative runtime import is rewritten for the output", () => {
  // The source says "../../runtime/mosaic.js"; the compiled file lives
  // elsewhere, so the specifier must become the --runtime value.
  const code =
    'import { Component } from "../../runtime/mosaic.js";\nclass A {}';
  const out = ensureRuntimeNames(code, "../../src/js/runtime/mosaic.js", [
    "h",
    "Fragment",
  ]);
  expect(out.match(/import/g)).toHaveLength(1);
  expect(
    out.startsWith(
      'import { h, Fragment, Component } from "../../src/js/runtime/mosaic.js";',
    ),
  ).toBe(true);
});

test("runtime import is added when absent", () => {
  const out = ensureRuntimeNames('const a = h("p", null);', "../mosaic.js", [
    "h",
    "Fragment",
  ]);
  expect(out.startsWith('import { h, Fragment } from "../mosaic.js";')).toBe(
    true,
  );
});

test("runtime import is left alone when complete", () => {
  const code = 'import { h, Fragment, Component } from "../mosaic.js";';
  expect(ensureRuntimeNames(code, "../mosaic.js", ["h", "Fragment"])).toBe(
    code,
  );
});

test("css imports become add styles calls", () => {
  const dir = tempDir({ "counter.css": ".a { color: red; }\n" });
  const [out, found] = inlineCssImports(
    'import "./counter.css";\nconst x = 1;',
    dir,
    null,
  );
  expect(found).toBe(true);
  expect(out.startsWith('addStyles("counter", ".a { color: red; }");')).toBe(
    true,
  );
  expect(out).toContain("const x = 1;");
});

test("css imports are found through source map markers", () => {
  // The transform inserts markers before this pass runs; a marker must not
  // hide the import, or the stylesheet is silently dropped.
  const dir = tempDir({ "counter.css": ".a { color: red; }" });
  const [out, found] = inlineCssImports(
    `${lineMarker(4)}import "./counter.css";\n`,
    dir,
    null,
  );
  expect(found).toBe(true);
  expect(out).toContain('addStyles("counter"');
  expect(out).toContain(lineMarker(4));
});

test("a sheet is keyed by itself and by the scope it was given", () => {
  // `addStyles` injects a key once per page, so the key has to say which sheet
  // *and* whose scope it is. One sheet imported by two modules is two sheets by
  // then — the same rules scoped to each — and a module importing two sheets
  // needs both. Keying by either alone drops one of them: it dropped
  // RadioGroup's own styles for months, and then a colour well's the day the
  // first was fixed.
  const dir = tempDir({
    "one.css": ".a { color: red; }\n",
    "two.css": ".b { color: blue; }\n",
  });

  const [both] = inlineCssImports(
    'import "./one.css";\nimport "./two.css";\n',
    dir,
    "hash1",
  );
  expect(both).toContain('addStyles("one-hash1"');
  expect(both).toContain('addStyles("two-hash1"');

  // And the same sheet under another scope is another key.
  const [again] = inlineCssImports('import "./one.css";\n', dir, "hash2");
  expect(again).toContain('addStyles("one-hash2"');
});

test("a missing stylesheet is an error", () => {
  const dir = tempDir();
  expect(() => inlineCssImports('import "./nope.css";', dir, null)).toThrow();
});

test("ordinary imports are left alone", () => {
  const dir = tempDir();
  const code =
    'import { Component } from "../mosaic.js";\nimport Card from "./Card.js";';
  const [out, found] = inlineCssImports(code, dir, null);
  expect(found).toBe(false);
  expect(out).toBe(code);
});

test("imported css is scoped to the module", () => {
  const dir = tempDir({
    "a.css": ".counter .step { width: 2rem; }\n:global(body) { margin: 0; }",
  });
  const [out] = inlineCssImports('import "./a.css";\n', dir, "scopex");
  expect(out).toContain(".counter .step.scopex{width: 2rem;}");
  expect(out).toContain("body{margin: 0;}");
});

test("dom elements carry the scope attribute", () => {
  const out = scoped('return <div styleName="a"><span>x</span></div>;');
  expect(out).toContain('h("div", { class: "a scopex" }');
  expect(out).toContain('h("span", { class: "scopex" }');
});

test("the view element is scoped too", () => {
  expect(scoped('return <View styleName="app"/>;')).toBe(
    'return h("div", { class: "app scopex" });',
  );
});

test("components and fragments are not scoped", () => {
  // A component styles its own markup; a fragment is not an element.
  expect(scoped('return <Card title="x"/>;')).not.toContain("scopex");
  const frag = scoped("return <><p>a</p></>;");
  expect(frag).toContain("h(Fragment, null");
  expect(frag).not.toContain("h(Fragment, { class");
});

test("element becomes h call", () => {
  expect(clean("const a = <p>hi</p>;")).toBe('const a = h("p", null, "hi");');
});

test("style name becomes class", () => {
  expect(clean('return <div styleName="box"/>;')).toBe(
    'return h("div", { class: "box" });',
  );
});

test("view tag is a div", () => {
  expect(clean('return <View styleName="app">x</View>;')).toBe(
    'return h("div", { class: "app" }, "x");',
  );
});

test("expressions pass through", () => {
  expect(clean("return <p>{this.count}</p>;")).toBe(
    'return h("p", null, (this.count));',
  );
});

test("attribute expressions pass through", () => {
  expect(clean("return <input value={this.name}/>;")).toBe(
    'return h("input", { value: (this.name) });',
  );
});

test("nested jsx inside an expression", () => {
  expect(clean("return <ul>{items.map((i) => <li>{i}</li>)}</ul>;")).toBe(
    'return h("ul", null, (items.map((i) => h("li", null, (i)))));',
  );
});

test("one action attribute binds several events", () => {
  const out = clean('return <button action="pointerdown:onDown keyup:onUp"/>;');
  expect(out).toContain("onpointerdown: (...__a) => this.onDown(...__a)");
  expect(out).toContain("onkeyup: (...__a) => this.onUp(...__a)");
  expect(() =>
    transform('return <b action="click:a click:b"/>;', null),
  ).toThrow();
});

test("an action on a component becomes its action prop", () => {
  // The child calls it; the method lives on the parent that drew it.
  expect(clean('return <Button action="decrement"/>;')).toBe(
    "return h(Button, { action: (...__a) => this.decrement(...__a) });",
  );
  expect(clean('return <List action="select:onSelect"/>;')).toContain(
    "selectAction: (...__a) => this.onSelect(...__a)",
  );
});

test("directives work in jsx", () => {
  const out = clean('return <button action="go" outlet="b"/>;');
  expect(out).toContain("onclick: (...__a) => this.go(...__a)");
  expect(out).toContain("ref: (__el) => { this.b = __el; }");
});

test("fragments are supported", () => {
  expect(clean("return <><p>a</p><p>b</p></>;")).toBe(
    'return h(Fragment, null, h("p", null, "a"), h("p", null, "b"));',
  );
});

test("components keep their identifier", () => {
  expect(clean('return <Card title="x"/>;')).toBe(
    'return h(Card, { title: "x" });',
  );
});

test("less than is not jsx", () => {
  expect(clean("const ok = a < b && c > d;")).toBe(
    "const ok = a < b && c > d;",
  );
});

test("jsx in strings is untouched", () => {
  expect(clean('const s = "<p>not jsx</p>";')).toBe(
    'const s = "<p>not jsx</p>";',
  );
});

test("class attribute is rejected", () => {
  expect(() => transform('return <p class="a"/>;', null)).toThrow();
});

test("spread props are merged", () => {
  expect(clean('return <p {...rest} id="a"/>;')).toBe(
    'return h("p", Object.assign({}, (rest), { id: "a" }));',
  );
});

// --- svg: imports -----------------------------------------------------------

const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M5 9l6 6"/></svg>';

test("an svg: import becomes the component that draws the icon", () => {
  const dir = tempDir({ "chevron-down.svg": CHEVRON });
  const [code, found] = inlineSvgImports(
    'import Chevron from "svg:chevron-down";\n',
    [dir],
  );

  expect(found).toBe(true);
  // The icon is markup, and compiles the way any other markup does.
  expect(code).toContain('h("svg", { viewBox: "0 0 24 24" }');
  expect(code).toContain('h("path", { d: "M5 9l6 6" })');
  // A component, so it is drawn where it is used rather than pasted in.
  expect(code).toContain("const Chevron = (props = {}) =>");
  expect(code).not.toContain("import Chevron");
});

test("the icon takes props, so it is sized and styled where it is used", () => {
  const dir = tempDir({ "chevron-down.svg": CHEVRON });
  const [code] = inlineSvgImports('import Chevron from "svg:chevron-down";\n', [
    dir,
  ]);

  // Whatever the caller passes wins over what the file said.
  expect(code).toContain("props: { ...__icon.props, ...props }");
});

test("the icon carries the scope of the module that imported it", () => {
  const dir = tempDir({ "plus.svg": CHEVRON });
  const [code] = inlineSvgImports(
    'import Plus from "svg:plus";\n',
    [dir],
    "abc1234",
  );

  expect(code).toContain('class: "abc1234"');
});

test("directories are searched nearest first, so an app can replace an icon", () => {
  const near = tempDir({ "close.svg": '<svg id="mine"></svg>' });
  const far = tempDir({ "close.svg": '<svg id="theirs"></svg>' });

  const [code] = inlineSvgImports('import Close from "svg:close";\n', [
    near,
    far,
  ]);
  expect(code).toContain('id: "mine"');
});

test("a missing icon is a build error, not a hole in the page", () => {
  const dir = tempDir({ "close.svg": CHEVRON });
  expect(() =>
    inlineSvgImports('import Nope from "svg:nope";\n', [dir]),
  ).toThrow(/no icon "svg:nope" — looked in/);
});

test("the .svg is optional, and everything else is left alone", () => {
  const dir = tempDir({ "close.svg": CHEVRON });
  expect(
    inlineSvgImports('import Close from "svg:close.svg";\n', [dir])[0],
  ).toContain("const Close =");

  const untouched =
    'import Control from "./Control.js";\nconst svg = "svg:not-an-import";\n';
  expect(inlineSvgImports(untouched, [dir])).toEqual([untouched, false]);
});

// --- image imports ----------------------------------------------------------

/** A 1x1 transparent PNG — the smallest real file of its kind. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_BASE64, "base64");

test("an image import becomes the data URL that names it", () => {
  const dir = tempDir({ "logo.png": PNG });
  const [code, found] = inlineImageImports(
    'import logo from "./logo.png";\n',
    dir,
  );

  expect(found).toBe(true);
  expect(code).toBe(`const logo = "data:image/png;base64,${PNG_BASE64}";\n`);
  expect(code).not.toContain("import logo");
});

test("the data URL says what kind of image it carries", () => {
  const dir = tempDir({
    "a.jpg": PNG,
    "b.JPEG": PNG,
    "c.gif": PNG,
    "d.webp": PNG,
    "e.avif": PNG,
    "f.ico": PNG,
  });
  const of = (file) =>
    inlineImageImports(`import x from "./${file}";\n`, dir)[0];

  expect(of("a.jpg")).toContain("data:image/jpeg;base64,");
  // The extension is read without regard to case, as a file system may be.
  expect(of("b.JPEG")).toContain("data:image/jpeg;base64,");
  expect(of("c.gif")).toContain("data:image/gif;base64,");
  expect(of("d.webp")).toContain("data:image/webp;base64,");
  expect(of("e.avif")).toContain("data:image/avif;base64,");
  expect(of("f.ico")).toContain("data:image/x-icon;base64,");
});

test("an image is found relative to the file that imported it", () => {
  const dir = tempDir({ "logo.png": PNG });
  fs.mkdirSync(path.join(dir, "views"));
  fs.writeFileSync(path.join(dir, "views", "own.png"), PNG);

  const views = path.join(dir, "views");
  expect(inlineImageImports('import a from "../logo.png";\n', views)[1]).toBe(
    true,
  );
  expect(inlineImageImports('import b from "./own.png";\n', views)[1]).toBe(
    true,
  );
});

test("a missing image is a build error, not a broken picture", () => {
  const dir = tempDir({ "logo.png": PNG });
  expect(() =>
    inlineImageImports('import x from "./nope.png";\n', dir),
  ).toThrow(/nope\.png/);
});

test("everything that is not an image import is left alone", () => {
  const dir = tempDir({ "logo.png": PNG });
  const untouched = [
    // A module, not an image.
    'import Control from "./Control.js";',
    // An svg: import is an icon, and becomes the component that draws it.
    'import Chevron from "svg:chevron-down";',
    // A package cannot be read off the disk beside the importer.
    'import png from "some-package/logo.png";',
    // Not an import at all.
    'const path = "./logo.png";',
  ].join("\n");

  expect(inlineImageImports(untouched, dir)).toEqual([untouched, false]);
});

test("an image import keeps the line marker it was compiled with", () => {
  const dir = tempDir({ "logo.png": PNG });
  const [code] = inlineImageImports(
    `${lineMarker(7)}import logo from "./logo.png";\n`,
    dir,
  );

  const [clean, mappings] = takeLineMarkers(code);
  expect(clean).toContain('const logo = "data:image/png;base64,');
  expect(mappings.length).toBe(1);
});
