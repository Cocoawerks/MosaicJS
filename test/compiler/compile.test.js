import {afterAll, expect, test} from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {compileFile, componentName, destination, hash, relativeSpecifier,} from "../../src/js/compiler/compile.js";
import {forModule, vlq} from "../../src/js/compiler/sourcemap.js";

const dirs = [];
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-"));
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

test("hash is stable, short, and a valid class name", () => {
  expect(hash("<p>a</p>")).toBe(hash("<p>a</p>"));
  expect(hash("<p>a</p>")).not.toBe(hash("<p>b</p>"));
  expect(hash("<p>a</p>")).toHaveLength(7);

    // The hash is the scope class, and `.7abcdef` is not a selector — so it
    // never starts with a digit.
    for (let i = 0; i < 500; i++) expect(hash(`source ${i}`)).toMatch(/^[a-z][a-z0-9]{6}$/);
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
    // An .mib gains an `.mib.js` suffix, so a page can sit beside a main.js of its own.
    expect(destination("examples/main.mib", {root: "examples", outdir: "build"})).toBe(
        "build/main.mib.js",
  );
});

test("vlq encodes like the spec", () => {
  expect(vlq(0)).toBe("A");
  expect(vlq(1)).toBe("C");
  expect(vlq(-1)).toBe("D");
  expect(vlq(16)).toBe("gB");
});

test("a module map carries its source and content", () => {
    const map = JSON.parse(forModule("../examples/main.mib", "<p>hi</p>\n", [[3, 1]]));
  expect(map.version).toBe(3);
    expect(map.sources).toEqual(["../examples/main.mib"]);
  expect(map.sourcesContent).toEqual(["<p>hi</p>\n"]);
  expect(map.mappings).toBe(";;AAAA;");
});

test("compiling a mib file writes the module and its map", () => {
  const dir = tempDir();
    fs.writeFileSync(path.join(dir, "main.mib"), '<div styleName="a">{title}</div>\n');
  const outdir = path.join(dir, "build");

    const dest = compileFile(path.join(dir, "main.mib"), {
    root: dir,
    outdir,
    runtime: "src/js/runtime/mosaic.js",
  });

    expect(dest).toBe(path.join(outdir, "main.mib.js"));
  const code = fs.readFileSync(dest, "utf8");
  expect(code).toContain("export default function Main(props = {}) {");
  expect(code).toContain('bindText(this, "title")');
  // No markers survive into the output.
  expect(code).not.toContain("/*@L");
    expect(code.trimEnd().endsWith("//# sourceMappingURL=main.mib.js.map")).toBe(true);

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
    expect(code).toMatch(/h\("div", \{ class: "card \w+" \}/);
  expect(code).toContain("addStyles(");
    // The stylesheet is scoped to this module, as a .mib <style> block would be.
    expect(code).toMatch(/\.card\.\w+/);
  // One runtime import, carrying both the source's names and the added ones.
  expect(code.match(/^import/gm)).toHaveLength(1);
  expect(code).toContain("h, Fragment, addStyles, Component");
});

test("a module beside an .mib of the same name gets its page in scope", () => {
  const dir = tempDir();
    fs.writeFileSync(path.join(dir, "main.mib"), "<p>{title}</p>\n");
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
    expect(code.startsWith('import Main from "./main.mib.js";')).toBe(true);
    expect(code.match(/main\.mib\.js/g)).toHaveLength(1);
});

test("the entry registers its page, so nothing has to name it", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "main.mib"), "<p>hi</p>\n");
    fs.writeFileSync(
        path.join(dir, "main.js"),
        'import { MosaicApplication } from "mosaic";\nnew MosaicApplication({ id: "app" });\n',
    );

    const dest = compileFile(path.join(dir, "main.js"), {
        root: dir,
        outdir: path.join(dir, "build"),
        runtime: "mosaic",
    });
    const code = fs.readFileSync(dest, "utf8");

    expect(code).toContain("MosaicApplication.registerPage(Main);");
    // It has to run before the module's own code, or the constructor sees no page.
    expect(code.indexOf("registerPage")).toBeLessThan(code.indexOf("new MosaicApplication"));
});

test("only the entry registers a page", () => {
    // A component and its markup are just that — registering would claim to be
    // the application's page.
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "Card.mib"), "<p>hi</p>\n");
    fs.writeFileSync(path.join(dir, "Card.js"), "export const x = 1;\n");

    const dest = compileFile(path.join(dir, "Card.js"), {
        root: dir,
        outdir: path.join(dir, "build"),
        runtime: "mosaic",
    });
    const code = fs.readFileSync(dest, "utf8");

    expect(code).toContain('import Card from "./Card.mib.js";');
    expect(code).not.toContain("registerPage");
    expect(code).not.toContain("MosaicApplication");
});

test("a module that imports its page itself is left alone", () => {
  const dir = tempDir();
    fs.writeFileSync(path.join(dir, "main.mib"), "<p>hi</p>\n");
    fs.writeFileSync(path.join(dir, "main.js"), 'import Page from "./main.mib.js";\nPage();\n');

  const dest = compileFile(path.join(dir, "main.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "mosaic",
  });

  // Saying so explicitly is never wrong, and must not be duplicated.
  const code = fs.readFileSync(dest, "utf8");
    expect(code.match(/main\.mib\.js/g)).toHaveLength(1);
    expect(code).toContain('import Page from "./main.mib.js";');
});

test("a module with no .mib beside it is untouched", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "AppController.js"), "export default class AppController {}\n");

  const dest = compileFile(path.join(dir, "AppController.js"), {
    root: dir,
    outdir: path.join(dir, "build"),
    runtime: "mosaic",
  });
    expect(fs.readFileSync(dest, "utf8")).not.toContain(".mib.js");
});

test("a parse error names the file and line", () => {
  const dir = tempDir();
    fs.writeFileSync(path.join(dir, "bad.mib"), "<div>\n<p>{count + 1}</p>\n</div>\n");
  expect(() =>
      compileFile(path.join(dir, "bad.mib"), {
      root: dir,
      outdir: path.join(dir, "build"),
      runtime: "src/js/runtime/mosaic.js",
    }),
  ).toThrow(/line 2/);
});
