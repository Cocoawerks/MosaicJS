// `mosaic init <name>`: the files a new application is created with.
//
// The CLI runs on import — it reads Bun.argv and exits — so this drives it the
// way a person does, as a subprocess, in a scratch directory it throws away.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BUN_DIR } from "../src/js/core/desktop/project.js";

const CLI = fileURLToPath(new URL("../bin/mosaic.js", import.meta.url));
const NAME = "MyApp";

/**
 * Every file `init` is expected to write, relative to the app directory.
 *
 * A new application is a web application: there is no main process here. The
 * native side is opt-in, written by `init desktop` into an application that
 * already exists — see the desktop tests at the bottom of this file.
 */
const EXPECTED = [
  "info.json",
  "index.html",
  "src/main.ib.xml",
  "src/AppController.js",
  "src/main.js",
  `src/${BUN_DIR}/services/greeting.js`,
];

/** A scratch directory, removed when the test that made it is done. */
function scratch(t) {
  // Resolved: on macOS the temp directory is reached through a symlink, and
  // `init` reports the real path.
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-init-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the CLI in `cwd`, and hand back what it did. */
function mosaic(cwd, ...argv) {
  const r = spawnSync("bun", [CLI, ...argv], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Every file under `dir`, relative and sorted, ignoring nothing. */
function tree(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)))
    .sort();
}

test("init creates exactly the scaffold, and nothing else", (t) => {
  const cwd = scratch(t);
  const { code, err } = mosaic(cwd, "init", NAME);

  assert.equal(code, 0, err);
  assert.deepEqual(tree(path.join(cwd, NAME)), [...EXPECTED].sort());
});

test("init reports what it wrote", (t) => {
  const cwd = scratch(t);
  const { out } = mosaic(cwd, "init", NAME);

  assert.match(out, new RegExp(`created ${path.join(cwd, NAME)}`));
  for (const file of EXPECTED) assert.ok(out.includes(file), `listed ${file}`);
  assert.match(out, new RegExp(`cd ${NAME} && mosaic web`));
});

test("every file has content", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);

  for (const file of EXPECTED) {
    const body = fs.readFileSync(path.join(cwd, NAME, file), "utf8");
    assert.ok(body.length > 0, `${file} is empty`);
    assert.ok(body.endsWith("\n"), `${file} has no final newline`);
  }
});

test("info.json names the application and its bootstrap", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);

  const config = JSON.parse(
    fs.readFileSync(path.join(cwd, NAME, "info.json"), "utf8"),
  );
  assert.deepEqual(config, {
    app_name: NAME,
    version: "0.1.0",
    author: "",
    // What the application is built against: a framework is reachable
    // because it is named, and a new application starts with the ui one.
    frameworks: ["ui"],
    main_file: "src/main.js",
  });
  // The bootstrap the config names is one of the files that was written.
  assert.ok(fs.existsSync(path.join(cwd, NAME, config.main_file)));
});

test("the page loads the bundle and hosts the application's element", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);

  const html = fs.readFileSync(path.join(cwd, NAME, "index.html"), "utf8");
  assert.match(html, /<title>MyApp<\/title>/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /<script type="module" src="build\/app\.js"><\/script>/);
});

test("the bootstrap starts an application on the page's element", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);

  const main = fs.readFileSync(path.join(cwd, NAME, "src/main.js"), "utf8");
  assert.match(main, /import \{ MosaicApplication \} from "mosaic";/);
  assert.match(main, /import AppController from "\.\/AppController\.js";/);
  assert.match(main, /id: "app"/);
  assert.match(main, /new AppController\(\)/);
});

test("the controller is the default export main.js imports", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);

  const controller = fs.readFileSync(
    path.join(cwd, NAME, "src/AppController.js"),
    "utf8",
  );
  assert.match(controller, /export default class AppController/);
});

test("the native side opens a window titled after the app", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);
  // The main process is opt-in: `init` alone does not write one.
  mosaic(path.join(cwd, NAME), "init", "desktop");

  const index = fs.readFileSync(
    path.join(cwd, NAME, `src/${BUN_DIR}/index.js`),
    "utf8",
  );
  // The window comes from the framework, which re-exports electrobun.
  assert.match(index, /from "mosaic\/desktop"/);
  assert.match(index, /title: "MyApp"/);
  assert.match(index, /url: "views:\/\/mainview\/index\.html"/);
});

test("init refuses to write over an existing application", (t) => {
  const cwd = scratch(t);
  assert.equal(mosaic(cwd, "init", NAME).code, 0);

  const before = fs.readFileSync(path.join(cwd, NAME, "info.json"), "utf8");
  const { code, err } = mosaic(cwd, "init", NAME);

  assert.equal(code, 1);
  assert.match(err, /already has/);
  assert.equal(
    fs.readFileSync(path.join(cwd, NAME, "info.json"), "utf8"),
    before,
    "the existing application was left alone",
  );
});

test("init needs a name", (t) => {
  const cwd = scratch(t);
  const { code, err } = mosaic(cwd, "init");

  assert.equal(code, 1);
  assert.match(err, /needs a name/);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

for (const bad of ["nested/app", ".", "..", "/tmp/app"]) {
  test(`init rejects \`${bad}\` — not a directory name`, (t) => {
    const cwd = scratch(t);
    const { code, err } = mosaic(cwd, "init", bad);

    assert.equal(code, 1);
    assert.match(err, /is not a directory name/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });
}

// --- `mosaic install framework <name>` ---------------------------------------
//
// Two halves: the tree is copied into the application's own `frameworks/`, and
// the application is made to say it is built against it. A framework that is
// here but unnamed is not in scope, so neither half is enough alone.

/** The app directory of a freshly created application. */
function created(t) {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);
  return path.join(cwd, NAME);
}

/** What `info.json` in `dir` says. */
function config(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"));
}

test("init names the ui framework, so a new application can reach it", (t) => {
  assert.deepEqual(config(created(t)).frameworks, ["ui"]);
});

test("install framework copies the tree into the application", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "framework", "ui");

  assert.equal(code, 0, err);
  assert.ok(
    fs.existsSync(path.join(dir, "frameworks/ui/controls/button/Button.js")),
  );
});

test("and names it in info.json when it is not named yet", (t) => {
  const dir = created(t);
  const file = path.join(dir, "info.json");
  const data = config(dir);
  delete data.frameworks;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

  const { code, err } = mosaic(dir, "install", "framework", "ui");

  assert.equal(code, 0, err);
  assert.deepEqual(config(dir).frameworks, ["ui"]);
  // Every other key is left as it was, in the order it was in.
  assert.equal(config(dir).app_name, NAME);
});

test("naming it twice does not repeat it", (t) => {
  const dir = created(t);
  mosaic(dir, "install", "framework", "ui");

  assert.deepEqual(config(dir).frameworks, ["ui"]);
});

test("it will not write over a framework already there", (t) => {
  const dir = created(t);
  mosaic(dir, "install", "framework", "ui");
  const { code, err } = mosaic(dir, "install", "framework", "ui");

  assert.equal(code, 1);
  assert.match(err, /already here/);
});

test("a framework mosaic does not ship says what it has", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "framework", "nope");

  assert.equal(code, 1);
  assert.match(err, /ships no framework named "nope"/);
  assert.match(err, /it has ui/);
});

test("install framework needs a name", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "framework");

  assert.equal(code, 1);
  assert.match(err, /needs a name/);
});

// --- `mosaic install theme <name>` -------------------------------------------
//
// A theme is one stylesheet, so installing one is one file. What makes it
// reachable is where it lands: a build looks in the application's `themes/`
// before the ones a framework ships.

test("install theme copies the stylesheet into the application", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "theme", "pop");

  assert.equal(code, 0, err);
  assert.ok(fs.existsSync(path.join(dir, "themes/pop.css")));
});

test("and says how to wear it, rather than deciding that too", (t) => {
  const dir = created(t);
  const { out } = mosaic(dir, "install", "theme", "pop");

  assert.match(out, /"theme": "pop"/);
  // Which theme is worn stays the application's to say.
  assert.equal(config(dir).theme, undefined);
});

test("it will not write over a theme already there", (t) => {
  const dir = created(t);
  mosaic(dir, "install", "theme", "pop");
  const { code, err } = mosaic(dir, "install", "theme", "pop");

  assert.equal(code, 1);
  assert.match(err, /already here/);
});

test("a theme mosaic does not ship says what it has", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "theme", "nope");

  assert.equal(code, 1);
  assert.match(err, /ships no theme named "nope"/);
  assert.match(err, /aristo/);
});

test("install theme needs a name", (t) => {
  const dir = created(t);
  const { code, err } = mosaic(dir, "install", "theme");

  assert.equal(code, 1);
  assert.match(err, /needs a name/);
});

test("a theme the application keeps is what the build wears", (t) => {
  const dir = created(t);
  fs.mkdirSync(path.join(dir, "themes"));
  fs.writeFileSync(
    path.join(dir, "themes", "mine.css"),
    ":global(:root) { --accent-color: #123456; }\n",
  );
  const file = path.join(dir, "info.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ ...config(dir), theme: "mine" }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "src", "main.ib.xml"),
    '<interface><Button text="hi"/></interface>\n',
  );

  const { code, err } = mosaic(dir, "compile", "--quiet");

  assert.equal(code, 0, err);
  const bundle = fs.readFileSync(path.join(dir, "build/app.js"), "utf8");
  assert.match(bundle, /123456/);
});

// --- init desktop ----------------------------------------------------------
//
// The main process is not part of a new application. `init desktop` writes it
// into one that already exists, once, and never again — by the second run it is
// the author's file, not this template.

test("init desktop writes the main process a new application does not have", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);
  const app = path.join(cwd, NAME);
  const entry = path.join(app, "src", BUN_DIR, "index.js");

  assert.ok(!fs.existsSync(entry), "init alone leaves the native side out");

  const { code, out, err } = mosaic(app, "init", "desktop");

  assert.equal(code, 0, err);
  assert.ok(fs.existsSync(entry), "init desktop writes it");
  assert.match(out, /created/);

  const body = fs.readFileSync(entry, "utf8");
  assert.ok(body.length > 0, "index.js is empty");
  assert.ok(body.includes(NAME), "the window is titled after the app");
});

test("init desktop leaves a main process that is already there alone", (t) => {
  const cwd = scratch(t);
  mosaic(cwd, "init", NAME);
  const app = path.join(cwd, NAME);
  const entry = path.join(app, "src", BUN_DIR, "index.js");

  mosaic(app, "init", "desktop");
  fs.writeFileSync(entry, "// mine now\n");

  const { code, out } = mosaic(app, "init", "desktop");

  assert.equal(code, 0);
  assert.equal(fs.readFileSync(entry, "utf8"), "// mine now\n");
  assert.match(out, /already there/);
});
