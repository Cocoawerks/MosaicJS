#!/usr/bin/env bun
// mosaic — the project's build tool.
//
//   mosaic init <name>                    create a new application
//   mosaic compile [main.js]              compile the app and bundle it
//   mosaic dev [main.js] [--port 3000]    the same, then serve it
//   mosaic check [main.js]                the same, then run the browser test
//   mosaic clean [main.js]                delete the app's build directory
//
// The argument is the application's bootstrap — the `main.js` that imports the
// compiled page and mounts it. It defaults to `./main.js`, so running mosaic
// inside an app directory needs no argument at all.
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

import { compileAll } from "../src/js/compiler/build.js";
import { componentName } from "../src/js/compiler/compile.js";

const CONFIG = "info.json";
const ENTRY = "main.js";

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
  // Relative to the application directory, not the project root.
  outdir: "build",
};

const USAGE = `usage: mosaic <command> [${ENTRY}] [options]

commands:
  init <name>        create a new application in ./<name>
  compile            compile the application and bundle it
  dev                compile, then serve the application directory
  check              compile, then run the headless browser test
  clean              delete the application's build directory

The argument is the application's bootstrap, defaulting to ./${ENTRY}.
For \`init\` it is the application's name, and the directory to create.

options:
  --port <n>         port for \`dev\` (default 3000)
  --no-open          don't launch a browser
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
    // Environment configuration, read at run time. Only the name for now.
    "info.json": JSON.stringify({ app_name: name }, null, 2) + "\n",

    "main.ib": `<!-- ${name} — the page.

     Markup only: no logic, no <script>. Everything dynamic is a binding to the
     controller beside this file.

       <div styleName="box">        a class comes from styleName, never class
       <View styleName="box">       the same thing, spelled as a component
       {title}                      text bound to a controller property
       styleName="row {status}"     a binding inside an attribute value
       action="increment"           a click calls controller.increment()
       action="input:onInput"       any event, naming the method to call
       ib:outlet="field"            hands the DOM node to controller.field
       <Card limit="3" />           another component; its import is emitted

     A <style> block at the end is scoped to this file: its selectors only ever
     match this markup. Use :global(...) to opt one out.

     Nothing renders until there is markup here. -->
`,

    "AppController.js": `// The controller behind main.ib: the page's state, the values its {bindings}
// read, and the methods its actions fire.
//
// A controller is a plain object — it extends nothing and the runtime asks
// nothing of it. Properties are read by name, \`action=\` calls methods, and
// \`mount()\` wires the rendered view onto \`this.view\`, so a state change is
// pushed to the DOM with \`this.view.needsDisplay()\`.
export default class AppController {
  constructor() {}
}
`,

    "main.js": `// ${name} — the application bootstrap, and the entry mosaic bundles.
//
// \`main.ib\` is this module's page: it sits beside this file, so the compiler
// compiles it and puts \`Main\` in scope here — there is nothing to import. The
// runtime is vendored into the build as a package, so it is imported by name.
import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", component: Main, controller: new AppController() });
`,

    "index.html": `<!doctype html>
<meta charset="utf-8" />
<title>${name}</title>
<!-- One request: app.js carries the runtime, the components and the bootstrap. -->
<div id="app"></div>
<script type="module" src="build/app.js"></script>
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

  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content);
  }

  console.log(`created ${dir}`);
  for (const file of Object.keys(files)) console.log(`    ${file}`);
  console.log("");
  console.log(`    cd ${name} && mosaic dev`);
  return 0;
}

/**
 * Resolve the bootstrap. A directory argument means the `main.js` inside it;
 * no argument means the one in the current directory. Either way it has to
 * exist — there is nothing to compile without an entry point.
 */
function resolveEntry(arg) {
  let file = path.resolve(arg ?? ENTRY);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, ENTRY);

  if (!fs.existsSync(file)) {
    const where = arg ? file : path.resolve(ENTRY);
    throw new Error(
      `no ${ENTRY} at ${where} — ` +
        `pass the path to your application's bootstrap, or run mosaic beside one`,
    );
  }
  if (path.basename(file) !== ENTRY) {
    throw new Error(`the entry must be a ${ENTRY}, not ${path.basename(file)}`);
  }
  return file;
}

function parseArgs(argv) {
  const args = {
    command: null,
    entry: null,
    port: 3000,
    open: true,
    sourcemap: true,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      args.port = Number(argv[++i]);
      if (!Number.isInteger(args.port)) throw new Error("`--port` needs a number");
    } else if (a === "--no-open") args.open = false;
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
function layout(config, entry) {
  const source = path.dirname(entry);
  const outdir = path.join(source, config.outdir);
  return {
    source,
    name: path.basename(source),
    outdir,
    entry: path.join(outdir, ENTRY),
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
  const runtime = vendorRuntime(config, app).specifier;

  log(`==> compiling ${relative(app.source)}`);
  const written = compileAll(sources, {
    runtime,
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
  ".ib": "text/plain; charset=utf-8",
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
 * Load the app's check page in headless Chromium and read the verdict from its
 * title. The page reports `verdict PASS` or `verdict FAIL` once its assertions
 * have run.
 */
async function check(config, app, port) {
  const page = path.join(app.source, config.check ?? "browser-check.html");
  if (!fs.existsSync(page)) throw new Error(`no check page at ${page}`);

  const browser = ["chromium", "chromium-browser", "google-chrome", "brave"].find((b) =>
    Bun.which(b),
  );
  if (!browser) throw new Error("no chromium-like browser found");

  const url = `http://127.0.0.1:${port}/${path.relative(app.source, page)}`;
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

async function main(argv) {
  let args;
  let config;
  let app;
  try {
    args = parseArgs(argv);
    // `init` creates the entry the other commands need, so it runs before any
    // of them is resolved.
    if (args.command === "init") return init(args.entry);
    const entry = resolveEntry(args.entry);
    config = loadConfig(path.dirname(entry));
    // Paths in the config are relative to the project root.
    process.chdir(config.root);
    app = layout(config, entry);
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

  // The application directory is the server's root, so a page can only reach
  // what ships with the app — never up into the project around it.
  const server = serve(app.source, args.command === "check" ? 0 : args.port);

  if (args.command === "check") {
    let code;
    try {
      code = await check(config, app, server.port);
    } catch (e) {
      console.error(`mosaic: ${e.message}`);
      code = 1;
    }
    server.stop(true);
    return code;
  }

  const url = `http://localhost:${server.port}/`;
  console.log(`==> serving ${url}`);
  console.log("    Ctrl-C to stop");
  if (args.open) open(url);

  // Bun keeps the process alive while the server is listening.
  return null;
}

const code = await main(Bun.argv.slice(2));
if (code !== null) process.exit(code);
