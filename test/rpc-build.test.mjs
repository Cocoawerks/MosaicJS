// The build-time half of rpc: finding an application's services, and writing
// the module both hosts load them through.
//
// Why this is generated at all, and tested for it: the desktop bundles its Bun
// side from one entrypoint, and a bundler cannot follow an import worked out
// while the program runs. A directory read would work perfectly under
// `mosaic web` and ship nothing in the packaged app.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { findServices, registrySource } from "../src/js/frameworks/rpc/services.js";
import { writeProject } from "../src/js/core/desktop/project.js";

/** An application's `bun/` directory, holding the services named. */
function bunDir(t, names) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-rpc-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const services = path.join(dir, "bun", "services");
  fs.mkdirSync(services, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(
      path.join(services, name),
      `export default { async ping() { return "${name}"; } };\n`,
    );
  }
  return dir;
}

test("services are found by file name, in the order a page reads them", (t) => {
  const dir = bunDir(t, ["users.js", "notes.js", "billing.mjs"]);

  assert.deepEqual(
    findServices(path.join(dir, "bun")).map((s) => s.group),
    ["billing", "notes", "users"],
  );
});

test("and what is not a service is left out of the surface", (t) => {
  const dir = bunDir(t, ["notes.js", "_helper.js", "index.js", "notes.css", "not-a-name.js"]);

  // `_helper` says it is nobody else's; `index.js` gathers rather than serves;
  // a stylesheet is not a module; and a group has to be a name a page can
  // write after `api.`.
  assert.deepEqual(
    findServices(path.join(dir, "bun")).map((s) => s.group),
    ["notes"],
  );
});

test("an application with no services has none, rather than failing", (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-rpc-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(findServices(path.join(dir, "bun")), []);
});

test("the registry imports its neighbours, statically, and hands them over", (t) => {
  const dir = bunDir(t, ["notes.js", "users.js"]);
  const from = path.join(dir, "bun", "_mosaic");

  const source = registrySource(findServices(path.join(dir, "bun")), from);

  assert.match(source, /^import notes from "\.\.\/services\/notes\.js";$/m);
  assert.match(source, /^import users from "\.\.\/services\/users\.js";$/m);
  assert.match(source, /export default \{\n {2}notes,\n {2}users,\n\};/);
  assert.doesNotMatch(source, /await import|readdir/, "nothing worked out at run time");
});

// --- the desktop project ------------------------------------------------------

/** A whole application, and the project `mosaic desktop` would generate from it. */
function project(t, { services = ["notes.js"], ownMain = true } = {}) {
  const dir = bunDir(t, services);
  const source = dir;
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.renameSync(path.join(dir, "bun"), path.join(source, "src", "bun"));
  fs.writeFileSync(path.join(source, "src", "main.js"), "");
  if (ownMain) {
    fs.writeFileSync(
      path.join(source, "src", "bun", "index.js"),
      `import { BrowserWindow } from "electrobun/bun";\nnew BrowserWindow({ rpc: globalThis.mosaicRpc?.() });\n`,
    );
  }

  const app = {
    source,
    sourceRoot: path.join(source, "src"),
    bunDir: path.join(source, "src", "bun"),
    name: "app",
    outdir: path.join(source, "build"),
    outfile: path.join(source, "build", "app.js"),
  };
  const out = path.join(source, "build", "desktop");
  return {
    dir: out,
    written: writeProject({ app, config: { app_name: "App", version: "1.0" }, dir: out }),
  };
}

test("the desktop project carries the services, the dispatcher and the glue", (t) => {
  const { dir, written } = project(t);

  assert.deepEqual(written.services, ["notes"]);
  for (const file of [
    "bun/index.js",
    "bun/services/notes.js",
    "bun/_mosaic/dispatch.js",
    "bun/_mosaic/services.js",
    "bun/_mosaic-main.js",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} is there`);
  }

  // Electrobun starts at the generated module, which defines the rpc and then
  // imports the author's file — so their window is made after it exists.
  const config = fs.readFileSync(path.join(dir, "electrobun.config.ts"), "utf8");
  assert.match(config, /"entrypoint": "bun\/_mosaic-main\.js"/);

  const main = fs.readFileSync(path.join(dir, "bun/_mosaic-main.js"), "utf8");
  assert.match(main, /globalThis\.mosaicRpc =/);
  assert.match(main, /await import\("\.\/index\.js"\)/);
  assert.match(main, /"mosaic\.rpc"/);
});

test("the registry imports the copies, not the application's own tree", (t) => {
  const { dir } = project(t);
  const registry = fs.readFileSync(path.join(dir, "bun/_mosaic/services.js"), "utf8");

  // What the packaged app is built from is this directory. An import reaching
  // back out of it would tie the build to the machine that made it.
  assert.match(registry, /from "\.\.\/services\/notes\.js"/);
  assert.doesNotMatch(registry, /\.\.\/\.\.\//);
});

test("an application with services but no native side of its own still gets them", (t) => {
  // The `bun/` directory used to be copied only when it held an `index.js`,
  // which left the services of an app that never opens a window behind.
  const { dir, written } = project(t, { ownMain: false });

  assert.deepEqual(written.services, ["notes"]);
  assert.ok(fs.existsSync(path.join(dir, "bun/services/notes.js")));
  assert.match(
    fs.readFileSync(path.join(dir, "bun/index.js"), "utf8"),
    /globalThis\.mosaicRpc\?\.\(\)/,
    "and the generated window passes the rpc",
  );
});

test("an application with no services gets no glue, and starts where it always did", (t) => {
  const { dir, written } = project(t, { services: [] });

  assert.deepEqual(written.services, []);
  assert.equal(fs.existsSync(path.join(dir, "bun/_mosaic")), false);
  assert.equal(fs.existsSync(path.join(dir, "bun/_mosaic-main.js")), false);
  assert.match(
    fs.readFileSync(path.join(dir, "electrobun.config.ts"), "utf8"),
    /"entrypoint": "bun\/index\.js"/,
  );
});
