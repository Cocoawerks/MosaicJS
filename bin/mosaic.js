#!/usr/bin/env bun
// mosaic — the MosaicJS build tool.
//
//   mosaic init <name>                  create a new application
//   mosaic compile [dir]                compile the app and bundle it
//   mosaic dev [dir] [--port 3000]      the same, then serve it, rebuilding
//                                       whenever a source changes
//   mosaic check [dir]                  the same, then run the browser test
//   mosaic clean [dir]                  delete the app's build directory
//
// An application is a directory with an `info.json` in it. That is the only
// thing a command takes — the current directory by default — and `main_file`
// in the config says which module is the bootstrap.
//
// Everything beside that file is the application, and everything the build
// produces lands in a `build/` inside it. That makes the app directory the
// whole of the deployable thing — which is what `dev` serves as its root, so a
// page can never reach up out of the app it belongs to.
//
// `info.json` is the configuration, merged from the project root down to the
// application. The bundle is Bun's: it walks the import graph from the
// bootstrap, so the payload holds only what the entry actually reaches — the
// runtime included, each module exactly once.

import * as fs from "node:fs";
import * as path from "node:path";

import {compileAll} from "../src/js/compiler/build.js";
import {componentName} from "../src/js/compiler/compile.js";

const CONFIG = "info.json";
const ENTRY = "main.js";
/** Where an application's own modules live, relative to its directory. */
const SRC = "src";

const DEFAULTS = {
  runtime: "src/js/runtime/mosaic.js",
  // The tree the runtime lives in, copied into each app's build so the
  // application directory is genuinely self-contained: a compiled module can
  // reach the runtime without climbing out of the app it belongs to.
  runtimeRoot: "src/js",
  // What compiled code imports the runtime as. A bare specifier, resolved
  // through the copy `mosaic` vendors into the build.
  runtimeSpecifier: "mosaic",
  // Compiled alongside every application, into their own subdirectory of its
  // build. Each app gets its own copy: only the bundle is served, so the cost
  // is build output, and the app directory stays self-contained.
  libraries: [],
    // Both relative to the application directory, not the project root.
    main_file: `${SRC}/${ENTRY}`,
  outdir: "build",
};

const USAGE = `usage: mosaic <command> [dir] [options]

commands:
  init <name>        create a new application in ./<name>
  compile            compile the application and bundle it
  dev                compile, then serve it, rebuilding on every edit
  check              compile, then run the headless browser test
  clean              delete the application's build directory

The argument is the application's directory — one with an ${CONFIG} in it —
and defaults to the current one. \`main_file\` in that config names the
bootstrap. For \`init\` the argument is the application's name instead, and
the directory to create.

options:
  --port <n>         port for \`dev\` (default 3000)
  --page <path>      page for \`check\`, relative to the project root
  --no-open          don't launch a browser
  --no-watch         don't rebuild when sources change
  --no-sourcemap     skip source maps
  --quiet            only report failures
  -h, --help         this text

Configuration is ${CONFIG}, merged from the project root down to the app.`;

/** Config keys naming a path, resolved against the file that declared them. */
const PATH_KEYS = ["runtime", "runtimeRoot"];

/**
 * Load `info.json`, merging every one from the project root down to the
 * application. A nearer file wins key by key, so an application declares its
 * own name and inherits where the runtime lives from the project around it.
 *
 * Paths are resolved against the file that declared them, so each config means
 * the same thing wherever it is read from.
 */
function loadConfig(from) {
  const chain = [];
  let dir = path.resolve(from);
  for (;;) {
    const file = path.join(dir, CONFIG);
    if (fs.existsSync(file)) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) {
        throw new Error(`${file}: ${e.message}`);
      }
      chain.unshift({ dir, data });
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  if (chain.length === 0) {
    throw new Error(`no ${CONFIG} in this directory or any above it`);
  }

  const config = { ...DEFAULTS, root: chain[0].dir };
  for (const { dir, data } of chain) {
    for (const [key, value] of Object.entries(data)) {
      if (PATH_KEYS.includes(key)) config[key] = path.resolve(dir, value);
      else if (key === "libraries") {
        config.libraries = value.map((lib) => ({
          ...lib,
          input: path.resolve(dir, lib.input),
        }));
      } else config[key] = value;
    }
  }
  // Defaults are relative to the outermost config, which is the project root.
  for (const key of PATH_KEYS) {
    if (!path.isAbsolute(config[key])) config[key] = path.resolve(config.root, config[key]);
  }
  return config;
}

/** The files `init` writes. `name` is the application's name. */
function scaffold(name) {
  const component = componentName(name);

  return {
      // The application's configuration. Every key a project-level info.json
      // declares is inherited; what is set here overrides it.
      "info.json":
          JSON.stringify({app_name: name, main_file: `${SRC}/${ENTRY}`}, null, 2) + "\n",

      [`${SRC}/main.mib`]: `<!-- ${name} — the page.

     The markup itself has no logic: everything dynamic is a binding to the
     controller, which is AppController.js beside this file — or a <script>
     block here, if you would rather keep the page in one piece.

       <div styleName="box">        a class comes from styleName, never class
       <View styleName="box">       the same thing, spelled as a component
       {title}                      text bound to a controller property
       styleName="row {status}"     a binding inside an attribute value
       action="increment"           a click calls controller.increment()
       action="input:onInput"       any event, naming the method to call
       outlet="field"            hands the DOM node to controller.field
       <Card limit="3" />           another component; its import is emitted

     A <script> block holds this file's JavaScript — most often the controller
     the bindings above read. Its default export becomes that controller, and
     the page is wired to it with nothing else to write. It may declare a
     component too, JSX and all. It is a module: what it uses, it imports.

     One <style> block, anywhere in the file — it is hoisted out of the markup
     and scoped to this file, so its selectors only ever match this page. Use
     :global(...) to opt one out. Convention is to put it last.

     Nothing renders until there is markup here. -->
`,

      [`${SRC}/AppController.js`]: `// The controller behind main.mib: the page's state, the values its {bindings}
// read, and the methods its actions fire.
//
// A controller is a plain object — it extends nothing and the runtime asks
// nothing of it. Properties are read by name and \`action=\` calls methods.
// Binding to a property in the markup is what makes it observable, so assigning
// to it is all it takes to update the DOM.
export default class AppController {
  constructor() {}
}
`,

      [`${SRC}/${ENTRY}`]: `// ${name} — the application bootstrap, and the entry mosaic bundles.
//
// \`main.mib\` is this module's page: it sits beside this file, so the compiler
// compiles it and registers it as the application's page — there is nothing to
// import and nothing to name. The runtime is vendored into the build as a
// package, so it is imported by name.
import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
`,

    "index.html": `<!doctype html>

<html lang="en">

<head>
    <meta charset="utf-8" />
    <title>${name}</title>
</head>

<body>

<div id="app"></div>

<!-- One request: app.js carries the runtime, the components and the bootstrap. -->
<script type="module" src="build/app.js"></script>
</body>

</html>
`,
  };
}

/** Create a new application in `./<name>`. */
function init(name) {
  if (name !== path.basename(name) || name === "." || name === "..") {
    throw new Error(`\`${name}\` is not a directory name`);
  }

  const dir = path.resolve(name);
  const files = scaffold(name);

  // Never write over an application that is already there.
  const existing = Object.keys(files).filter((f) => fs.existsSync(path.join(dir, f)));
  if (existing.length > 0) {
    throw new Error(`${dir} already has ${existing.join(", ")}`);
  }

  for (const [file, content] of Object.entries(files)) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, content);
  }

  console.log(`created ${dir}`);
  for (const file of Object.keys(files)) console.log(`    ${file}`);
  console.log("");
  console.log(`    cd ${name} && mosaic dev`);
  return 0;
}

/**
 * Resolve the application a command was pointed at.
 *
 * An application is a directory with an `info.json`, and that is all a command
 * accepts: the current directory, or one named on the command line. Naming a
 * module instead would leave the config ambiguous — which is the thing that
 * says what the application is made of.
 */
function resolveApp(arg) {
    const dir = path.resolve(arg ?? ".");

    if (!fs.existsSync(dir)) throw new Error(`no such directory: ${dir}`);
    if (!fs.statSync(dir).isDirectory()) {
        throw new Error(
            `${dir} is a file — a command takes the application's directory, ` +
            `and \`main_file\` in its ${CONFIG} names the bootstrap`,
        );
    }
    if (!fs.existsSync(path.join(dir, CONFIG))) {
    throw new Error(
        `${dir} has no ${CONFIG} — run mosaic in an application directory, ` +
        `or name one`,
    );
  }
    return dir;
}

function parseArgs(argv) {
  const args = {
    command: null,
    entry: null,
    port: 3000,
      page: null,
    open: true,
      watch: true,
    sourcemap: true,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      args.port = Number(argv[++i]);
      if (!Number.isInteger(args.port)) throw new Error("`--port` needs a number");
    } else if (a === "--page") {
        args.page = argv[++i];
        if (!args.page) throw new Error("`--page` needs a path");
    } else if (a === "--no-open") args.open = false;
    else if (a === "--no-watch") args.watch = false;
    else if (a === "--no-sourcemap") args.sourcemap = false;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith("-")) throw new Error(`unknown option \`${a}\``);
    else if (!args.command) args.command = a;
    else if (!args.entry) args.entry = a;
    else throw new Error(`unexpected argument \`${a}\``);
  }

  if (!args.command) throw new Error("missing command");
  if (!["init", "compile", "dev", "check", "clean"].includes(args.command)) {
    throw new Error(`unknown command \`${args.command}\``);
  }
  if (args.command === "init" && !args.entry) throw new Error("`init` needs a name");
  return args;
}

/**
 * Where an application's build lands: a `build/` inside the application itself.
 * Two apps in one project therefore never write over each other, and each one
 * is self-contained — its directory holds its sources, its output and the page
 * that loads them, with nothing above it needed.
 */
function layout(config, source) {
  const outdir = path.join(source, config.outdir);
    const main = path.join(source, config.main_file);

    if (!fs.existsSync(main)) {
        throw new Error(`${CONFIG} names main_file "${config.main_file}", which is not in ${source}`);
    }

  return {
    source,
    name: path.basename(source),
    outdir,
      // The bootstrap keeps its place in the tree, so `src/main.js` compiles to
      // `build/src/main.js`. The bundle sits at the top of the build either way:
      // it is what the page loads, and has no source position to keep.
      entry: path.join(outdir, path.relative(source, main)),
    outfile: path.join(outdir, "app.js"),
  };
}

/**
 * Copy the runtime tree into the app's build as a package, so compiled code can
 * import it by name: `import { MosaicApplication } from "mosaic"`.
 *
 * It lands in `build/node_modules/mosaic/`, which is the one layout every
 * resolver already understands — Bun's bundler and node find it with no
 * configuration, and a browser needs only the import map the host page carries.
 * Vendoring is also what lets `dev` serve the app as its root: a module
 * reaching `../../src/...` would be reaching outside what the app ships.
 */
function vendorRuntime(config, app) {
  const root = config.runtimeRoot;
  const runtime = config.runtime;
  if (!runtime.startsWith(root + path.sep)) {
    throw new Error(`runtime ${runtime} is not inside runtimeRoot ${root}`);
  }

  const name = config.runtimeSpecifier;
  const dest = path.join(app.outdir, "node_modules", name);
  const main = "./" + path.relative(root, runtime).split(path.sep).join("/");

  // The compiler is not part of the runtime and has no business being served.
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (src) => path.basename(src) !== "compiler",
  });
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({ name, type: "module", main, exports: { ".": main } }, null, 2) + "\n",
  );
  return { specifier: name, main: path.join(dest, main) };
}

/**
 * What the runtime exports, read from the module that exports it. A `<script>`
 * naming one of these gets it imported; the list is the runtime's own, so it
 * cannot drift from what is actually there.
 */
function runtimeExports(main) {
    const source = fs.readFileSync(main, "utf8");
    const names = new Set();

    for (const line of source.split("\n")) {
        const braced = line.match(/^\s*export\s*\{([^}]*)\}/);
        if (braced) {
            for (const part of braced[1].split(",")) {
                const name = part.trim().split(/\s+as\s+/).pop()?.trim();
                if (name) names.add(name);
            }
            continue;
        }
        const declared = line.match(/^\s*export\s+(?:default\s+)?(?:class|function|const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u);
        if (declared) names.add(declared[1]);
    }
    return [...names];
}

/** The library trees, resolved into this application's build directory. */
function librarySources(config, app) {
  return config.libraries.map((lib) => ({
    input: lib.input,
    outdir: path.join(app.outdir, lib.outdir),
  }));
}

/** Compile the libraries and the application, then bundle from the entry. */
async function compile(config, app, args) {
  const log = args.quiet ? () => {} : (...a) => console.log(...a);
  const relative = (p) => path.relative(config.root, p) || ".";

  const sources = [
    ...librarySources(config, app),
    { input: relative(app.source), outdir: app.outdir },
  ];

  // The whole build is this run's to rewrite, so a renamed or deleted source
  // cannot leave a stale module behind.
  fs.rmSync(app.outdir, { recursive: true, force: true });
    const vendored = vendorRuntime(config, app);

  log(`==> compiling ${relative(app.source)}`);
  const written = compileAll(sources, {
      runtime: vendored.specifier,
      runtimeExports: runtimeExports(vendored.main),
    sourcemap: args.sourcemap,
    onFile: args.quiet ? undefined : (src, dest) => log(`    ${src} -> ${dest}`),
  });
  log(`    ${written.length} modules`);

  log("==> bundling");
  const result = await Bun.build({
    entrypoints: [app.entry],
    outdir: path.dirname(app.outfile),
    naming: path.basename(app.outfile),
    sourcemap: args.sourcemap ? "linked" : "none",
    target: "browser",
  });
  if (!result.success) {
    for (const message of result.logs) console.error(String(message));
    throw new Error(`could not bundle ${app.entry}`);
  }

  const bytes = fs.statSync(app.outfile).size;
  log(`    ${app.outfile}  ${(bytes / 1024).toFixed(1)} KB`);
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
    ".mib": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serve `root` as static files; a directory serves its index.html. */
function serve(root, port) {
  const base = path.resolve(root);

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      let target = path.join(base, decodeURIComponent(url.pathname));

      // Nothing outside the served root, whatever the path claims.
      if (target !== base && !target.startsWith(base + path.sep)) {
        return new Response("forbidden", { status: 403 });
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, "index.html");
      }

      const file = Bun.file(target);
      if (!(await file.exists())) return new Response("not found", { status: 404 });

      const type = CONTENT_TYPES[path.extname(target)];
      return new Response(file, {
        // Always revalidate: the point of `dev` is that a rebuild is visible.
        headers: { "cache-control": "no-store", ...(type ? { "content-type": type } : {}) },
      });
    },
  });
}

function open(url) {
  for (const cmd of ["xdg-open", "open", "chromium", "google-chrome", "firefox"]) {
    if (!Bun.which(cmd)) continue;
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
    return true;
  }
  return false;
}

/**
 * Load the check page in headless Chromium and read the verdict from its
 * title. The page reports `verdict PASS` or `verdict FAIL` once its assertions
 * have run.
 *
 * It is a test of the compiler and runtime rather than a page of the
 * application, so it lives with the other tests and is served from the project
 * root — reaching across into whichever app's build it exercises.
 */
async function check(config, app, port, override) {
    const page = path.resolve(config.root, override ?? config.check ?? "test/browser-check.html");
  if (!fs.existsSync(page)) throw new Error(`no check page at ${page}`);

  const browser = ["chromium", "chromium-browser", "google-chrome", "brave"].find((b) =>
    Bun.which(b),
  );
  if (!browser) throw new Error("no chromium-like browser found");

    const url = `http://127.0.0.1:${port}/${path.relative(config.root, page)}`;
  const proc = Bun.spawn(
    [browser, "--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=5000",
      "--dump-dom", url],
    { stdout: "pipe", stderr: "ignore" },
  );
  const dom = await new Response(proc.stdout).text();

  // Read the verdict from the rendered <title>, not from anywhere in the dump:
  // the page's own script source is part of the DOM, so matching the whole
  // document would find the literal "PASS" it assigns and always succeed.
  const results = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1] ?? "";
  for (const line of results.split("\n")) {
    if (/^\s*(PASS|FAIL|ERROR)/.test(line)) console.log(line.trim());
  }

  const title = dom.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
  if (title.includes("verdict PASS")) {
    console.log("==> browser check PASSED");
    return 0;
  }
  if (title.includes("verdict FAIL")) {
    console.error(`==> browser check FAILED: ${title}`);
    return 1;
  }
  console.error(`==> browser check did not finish (title: ${title || "none"})`);
  console.error(`    the page threw before reporting; open ${url}`);
  return 1;
}


/**
 * Rebuild whenever a source changes.
 *
 * Everything the build reads is watched — the application, the libraries it
 * compiles against and the runtime it is vendored from — because a change in
 * any of them makes what is being served stale. The build directory is not:
 * writing to it is what a rebuild *does*, and watching it would never settle.
 *
 * The server keeps running throughout. It reads from disk on every request, so
 * a finished rebuild is live at the next reload with nothing to restart.
 */
function watchSources(config, app, args) {
    const roots = [app.source, config.runtimeRoot, ...config.libraries.map((lib) => lib.input)];

    // A tree already covered by an ancestor is watched twice otherwise.
    const covered = (dir) =>
        roots.some((other) => other !== dir && dir.startsWith(other + path.sep));
    const watched = [...new Set(roots)].filter((dir) => fs.existsSync(dir) && !covered(dir));

    const outdir = path.resolve(app.outdir);
    const ignored = (root, file) => {
        if (!file) return true;
        const full = path.resolve(root, file);
        // Editors write backups and swap files beside the real one.
        if (path.basename(file).startsWith(".") || file.endsWith("~")) return true;
        return full === outdir || full.startsWith(outdir + path.sep);
    };

    let timer = null;
    let building = false;
    let pending = false;

    const rebuild = async () => {
        if (building) {
            pending = true;
            return;
        }
        building = true;
        const started = Date.now();
        try {
            await compile(config, app, {...args, quiet: true});
            console.log(`    rebuilt in ${Date.now() - started}ms — reload to see it`);
        } catch (e) {
            // A broken source is the normal case while editing: report it and keep
            // watching, rather than taking the server down with it.
            console.error(`mosaic: ${e.message}`);
        } finally {
            building = false;
            if (pending) {
                pending = false;
                rebuild();
            }
        }
    };

    for (const root of watched) {
        fs.watch(root, {recursive: true}, (event, file) => {
            if (ignored(root, file)) return;
            // One edit can arrive as several events; wait for the flurry to stop.
            clearTimeout(timer);
            timer = setTimeout(rebuild, 60);
        });
    }

    return watched;
}

async function main(argv) {
  let args;
  let config;
  let app;
  try {
    args = parseArgs(argv);
      // `init` creates the application the other commands need, so it runs
      // before any of them is resolved.
    if (args.command === "init") return init(args.entry);
      const source = resolveApp(args.entry);
      config = loadConfig(source);
    // Paths in the config are relative to the project root.
    process.chdir(config.root);
      app = layout(config, source);
  } catch (e) {
    console.error(`mosaic: ${e.message}\n\n${USAGE}`);
    return 1;
  }

  if (args.command === "clean") {
    if (fs.existsSync(app.outdir)) {
      fs.rmSync(app.outdir, { recursive: true, force: true });
      console.log(`removed ${app.outdir}`);
    } else {
      console.log(`nothing to clean at ${app.outdir}`);
    }
    return 0;
  }

  try {
    await compile(config, app, args);
  } catch (e) {
    console.error(`mosaic: ${e.message}`);
    return 1;
  }

  if (args.command === "compile") return 0;

    // `dev` serves the application directory, so a page can only reach what
    // ships with the app. `check` is a test of the project, and serves that.
    const server =
        args.command === "check" ? serve(config.root, 0) : serve(app.source, args.port);

  if (args.command === "check") {
    let code;
    try {
        code = await check(config, app, server.port, args.page);
    } catch (e) {
      console.error(`mosaic: ${e.message}`);
      code = 1;
    }
    server.stop(true);
    return code;
  }

  const url = `http://localhost:${server.port}/`;
  console.log(`==> serving ${url}`);
    if (args.watch) {
        const watched = watchSources(config, app, args);
        console.log(`    watching ${watched.map((d) => path.relative(config.root, d) || ".").join(", ")}`);
    }
  console.log("    Ctrl-C to stop");
  if (args.open) open(url);

  // Bun keeps the process alive while the server is listening.
  return null;
}

const code = await main(Bun.argv.slice(2));
if (code !== null) process.exit(code);
