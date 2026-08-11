import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  compileFile,
  componentName,
  destination,
  hash,
  relativeSpecifier,
} from "../../src/js/compiler/compile.js";
import { forModule, vlq } from "../../src/js/compiler/sourcemap.js";

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ibcompile-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("component name is the pascal cased stem", () => {
  expect(componentName("main")).toBe("Main");
  expect(componentName("my-widget")).toBe("MyWidget");
  expect(componentName("my_widget")).toBe("MyWidget");
  // The result has to be a valid identifier.
  expect(componentName("2fast")).toBe("_2fast");
});

test("hash is stable and short", () => {
  expect(hash("<p>a</p>")).toBe(hash("<p>a</p>"));
  expect(hash("<p>a</p>")).not.toBe(hash("<p>b</p>"));
  expect(hash("<p>a</p>")).toHaveLength(7);
});

test("the runtime specifier is written for the output location", () => {
  // --runtime is given from the working directory; each output file gets the
  // path that is correct from where it lands.
  expect(relativeSpecifier("src/js/runtime/mosaic.js", "build")).toBe(
    "../src/js/runtime/mosaic.js",
  );
  expect(relativeSpecifier("src/js/runtime/mosaic.js", "build/ui/button")).toBe(
    "../../../src/js/runtime/mosaic.js",
  );
});

test("outdir mirrors the input tree", () => {
  expect(
    destination("components/button/Button.js", { root: "components", outdir: "build/ui" }),
  ).toBe("build/ui/button/Button.js");
  // An .ib gains an `.ib.js` suffix, so a page can sit beside a main.js of its own.
  expect(destination("examples/main.ib", { root: "examples", outdir: "build" })).toBe(
    "build/main.ib.js",
  );
});

test("vlq encodes like the spec", () => {
  expect(vlq(0)).toBe("A");
  expect(vlq(1)).toBe("C");
  expect(vlq(-1)).toBe("D");
  expect(vlq(16)).toBe("gB");
});

test("a module map carries its source and content", () => {
  const map = JSON.parse(forModule("../examples/main.ib", "<p>hi</p>\n", [[3, 1]]));
  expect(map.version).toBe(3);
  expect(map.sources).toEqual(["../examples/main.ib"]);
  expect(map.sourcesContent).toEqual(["<p>hi</p>\n"]);
  expect(map.mappings).toBe(";;AAAA;");
});

test("compiling an ib file writes the module and its map", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "main.ib"), '<div styleName="a">{title}</div>\n');
  const outdir = path.join(dir, "build");

  const dest = compileFile(path.join(dir, "main.ib"), {
    root: dir,
    outdir,
    runtime: "src/js/runtime/mosaic.js",
  });

  expect(dest).toBe(path.join(outdir, "main.ib.js"));
  const code = fs.readFileSync(dest, "utf8");
  expect(code).toContain("export default function Main(props = {}) {");
  expect(code).toContain('bindText(this, "title")');
  // No markers survive into the output.
  expect(code).not.toContain("/*@L");
  expect(code.trimEnd().endsWith("//# sourceMappingURL=main.ib.js.map")).toBe(true);

  const map = JSON.parse(fs.readFileSync(dest + ".map", "utf8"));
  expect(map.sourcesContent[0]).toContain("styleName");
});

test("compiling a js file rewrites its jsx and inlines its css", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "card.css"), ".card { color: red; }\n");
  fs.writeFileSync(
    path.join(dir, "Card.js"),
    'import { Component } from "../src/js/runtime/mosaic.js";\n' +
      'import "./card.css";\n' +
      "export default class Card extends Component {\n" +
      '  draw() { return <View styleName="card">hi</View>; }\n' +
      "}\n",
  );

  const dest = compileFile(path.join(dir, "Card.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "src/js/runtime/mosaic.js",
  });

  const code = fs.readFileSync(dest, "utf8");
  expect(code).toContain('h("div", { class: "card"');
  expect(code).toContain("addStyles(");
  // The stylesheet is scoped to this module, as a .ib <style> block would be.
  expect(code).toMatch(/\.card\[data-mosaic-\w+\]/);
  // One runtime import, carrying both the source's names and the added ones.
  expect(code.match(/^import/gm)).toHaveLength(1);
  expect(code).toContain("h, Fragment, addStyles, Component");
});

test("a module beside an .ib of the same name gets its page in scope", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "main.ib"), "<p>{title}</p>\n");
  fs.writeFileSync(
    path.join(dir, "main.js"),
    'import { MosaicApplication } from "mosaic";\n' +
      'new MosaicApplication({ id: "app", component: Main });\n',
  );

  const dest = compileFile(path.join(dir, "main.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "mosaic",
  });

  // `Main` is bound without main.js having imported a file it never wrote.
  const code = fs.readFileSync(dest, "utf8");
  expect(code.startsWith('import Main from "./main.ib.js";')).toBe(true);
  expect(code.match(/main\.ib\.js/g)).toHaveLength(1);
});

test("a module that imports its page itself is left alone", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "main.ib"), "<p>hi</p>\n");
  fs.writeFileSync(path.join(dir, "main.js"), 'import Page from "./main.ib.js";\nPage();\n');

  const dest = compileFile(path.join(dir, "main.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "mosaic",
  });

  // Saying so explicitly is never wrong, and must not be duplicated.
  const code = fs.readFileSync(dest, "utf8");
  expect(code.match(/main\.ib\.js/g)).toHaveLength(1);
  expect(code).toContain('import Page from "./main.ib.js";');
});

test("a module with no .ib beside it is untouched", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "AppController.js"), "export default class AppController {}\n");

  const dest = compileFile(path.join(dir, "AppController.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "mosaic",
  });
  expect(fs.readFileSync(dest, "utf8")).not.toContain(".ib.js");
});

test("a parse error names the file and line", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "bad.ib"), "<div>\n<p>{count + 1}</p>\n</div>\n");
  expect(() =>
    compileFile(path.join(dir, "bad.ib"), {
      root: dir,
      outdir: path.join(dir, "build"),
      runtime: "src/js/runtime/mosaic.js",
    }),
  ).toThrow(/line 2/);
});
