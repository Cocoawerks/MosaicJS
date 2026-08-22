#!/usr/bin/env bun
// mosaic — the MosaicJS build tool.
//
//   mosaic init <name>                  create a new application
//   mosaic compile [dir]                compile the app and bundle it
//   mosaic server [dev] [dir]           the same, then serve it, rebuilding
//                                       and restarting on every change
//   mosaic desktop [dev] [dir]          the same, run as a native desktop app
//   mosaic check [dir]                  the same, then run the browser test
//   mosaic clean [dir]                  delete the app's build directory
//
// An application is a directory with an `info.json` in it. That is the only
// thing a command takes — the current directory by default — and `main_file`
// in the config says which module is the bootstrap.
//
// The application's code is the tree `main_file` sits in — everything beside
// it and below it, and nothing above — so `info.json` can sit further up,
// at the root of a project whose other directories are none of the compiler's
// business. Everything the build produces lands in a `build/` inside the app
// directory. That makes the app directory the whole of the deployable thing —
// which is what `server` serves as its root, so a page can never reach up out of
// the app it belongs to.
//
// `info.json` is the configuration, merged from the project root down to the
// application. The bundle is Bun's: it walks the import graph from the
// bootstrap, so the payload holds only what the entry actually reaches — the
// runtime included, each module exactly once.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { compileAll } from "../src/js/core/compiler/build.js";
import { componentName } from "../src/js/core/compiler/compile.js";
import { scope as scopeCss } from "../src/js/core/compiler/css.js";
import {
  BUN_DIR,
  DESKTOP_DIR,
  findElectrobun,
  installDependencies,
  writeProject,
} from "../src/js/core/desktop/project.js";

const CONFIG = "info.json";

/**
 * How a run is meant. `dev` builds for editing and keeps up with the edits;
 * `prod` will build for shipping, and does not exist yet.
 */
const MODES = ["dev", "prod"];
/** The commands that run an application, and so have a mode to be run in. */
const MODE_COMMANDS = ["server", "desktop"];

/**
 * Where mosaic itself lives: the tree holding the runtime and the frameworks.
 *
 * They ship with the tool, not with the applications built by it — an
 * application says what it is, and mosaic knows where its own parts are. That
 * is why nothing above an application needs an `info.json` of its own.
 *
 * Found in the order a run can be sure of:
 *
 *   1. `MOSAIC_HOME`, for pointing an installed mosaic at a checkout.
 *   2. What `make install` baked in, which is where it put those trees. A
 *      standalone executable holds only its own code — the runtime is data it
 *      copies into a build, and lives beside the binary rather than inside it.
 *   3. This file's own checkout, which is the case when running from source.
 */
function mosaicHome() {
  if (process.env.MOSAIC_HOME) return path.resolve(process.env.MOSAIC_HOME);

  // Replaced at build time by `make install`; absent when running from source.
  const installed =
    typeof MOSAIC_INSTALLED_HOME === "string" ? MOSAIC_INSTALLED_HOME : null;
  if (installed) return installed;

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const HOME = mosaicHome();

/** How `HOME` was arrived at, for an error message that can be acted on. */
function homeSource() {
  if (process.env.MOSAIC_HOME) return "where MOSAIC_HOME points";
  if (typeof MOSAIC_INSTALLED_HOME === "string")
    return "where this mosaic was installed";
  return "this mosaic's own directory";
}
const ENTRY = "main.js";
/** Where an application's own modules live, relative to its directory. */
const SRC = "src";
/** Where frameworks land inside the vendored runtime package, and their subpath. */
const FRAMEWORKS = "frameworks";
/** Where a framework keeps its themes, one stylesheet each. */
const THEMES = "themes";
/** The module a framework's themes are written into, beside its index. */
const THEME_MODULE = "theme.js";
/**
 * How a theme names its dark counterpart: `aristo` and `aristo_dark` are one
 * theme in two lights, and a build that carries the first carries the second
 * so the page can follow whichever the reader asked their system for.
 */
const DARK_SUFFIX = "_dark";
/** Where a framework keeps its icons, beside the themes that style them. */
const ICONS = `${THEMES}/icons`;

const DEFAULTS = {
  runtime: path.join(HOME, "src/js/core/runtime/mosaic.js"),
  // The tree the runtime lives in, copied into each app's build so the
  // application directory is genuinely self-contained: a compiled module can
  // reach the runtime without climbing out of the app it belongs to.
  runtimeRoot: path.join(HOME, "src/js/core"),
  // What compiled code imports the runtime as. A bare specifier, resolved
  // through the copy `mosaic` vendors into the build.
  runtimeSpecifier: "mosaic",
  // Compiled alongside every application, into their own subdirectory of its
  // build. Each app gets its own copy: only the bundle is served, so the cost
  // is build output, and the app directory stays self-contained.
  libraries: [],
  // Component libraries that ship as part of the runtime package, imported by
  // name: `import {Button} from "mosaic/frameworks/ui"`. Each is
  // `{name, input}` — a source tree compiled into the vendored package under
  // `frameworks/<name>/`, where the subpath export points at the index the
  // build generates for it.
  frameworks: [{ name: "ui", input: path.join(HOME, "src/js/frameworks/ui") }],
  // Which of a framework's `themes/` its components are built against — the
  // stylesheet of custom properties they read. One name for the whole build:
  // the theme is the application's, not a component's.
  theme: "aristo",
  // Themes to carry besides the one worn, so a page can switch at run time.
  // Each one named is in the bundle: an application that never switches
  // should leave this alone and pay for one stylesheet.
  //
  // Families, not lights: naming `aristo` brings `aristo_dark` with it, so a
  // dark counterpart never has to be asked for. See `disable_dark_theme`.
  themes: [],
  // Whether to carry only the light half of each theme named above.
  //
  // A theme with a `_dark` beside it is one theme in two lights, and a build
  // carries both so the page can wear whichever the reader's system asks for
  // and follow it if they change their mind. An application that wants to be
  // one way whatever the reader prefers turns this on, and pays for one
  // stylesheet per theme rather than two.
  disable_dark_theme: false,
  // What this application is and who wrote it. Both are carried into the
  // package the build vendors, so what was built says so itself.
  version: "0.0.0",
  author: "",
  // Packages the application itself needs at run time, by name and version, the
  // way a package.json states them — installed into the generated project, so
  // an application says what it is in one file and owns no manifest.
  //
  // Only what the application chose. What a mosaic app is built out of is not
  // listed here and never has to be: the runtime is vendored by the compiler
  // and Electrobun is installed by `desktop`, both without being asked.
  dependencies: {},
  // Both relative to the application directory, not the project root.
  main_file: `${SRC}/${ENTRY}`,
  outdir: "build",
  // The page `check` opens. Mosaic's own, unless an application names one.
  check: path.join(HOME, "test/browser-check.html"),
};

const USAGE = `usage: mosaic <command> [dir] [options]

commands:
  init <name>        create a new application in ./<name>
  install            install what "dependencies" in ${CONFIG} names
  compile            compile the application and bundle it
  server [dev|prod]  compile, then serve it, rebuilding on every edit
  desktop [dev|prod] compile, then run it as a native desktop app
  check              compile, then run the headless browser test
  clean              delete the application's build directory

The argument is the application's directory — one with an ${CONFIG} in it —
and defaults to the current one. \`main_file\` in that config names the
bootstrap. For \`init\` the argument is the application's name instead, and
the directory to create.

\`server\` and \`desktop\` take a mode. \`dev\`, the default, keeps up with
the edits: everything from \`main_file\`'s directory down is watched — the
\`${BUN_DIR}/\` included — and every change rebuilds and runs it again.
\`prod\` is not implemented yet.

options:
  --port <n>         port for \`server\` (default 3000)
  --page <path>      page for \`check\`, relative to the current directory
  --no-open          don't launch a browser
  --no-watch         don't rebuild when sources change
  --no-sourcemap     skip source maps
  --quiet            only report failures
  --keep-modules     leave the compiled modules the bundle was built from
  --minify           minify the bundle
  -h, --help         this text

\`desktop\` builds the desktop project itself, inside the build directory, on
every run, and installs into it: the app's own "dependencies" from ${CONFIG},
and the toolkit it runs on, which no app has to name. A \`${BUN_DIR}/\` beside
\`main_file\` is the app's native side by convention: its \`index.js\` is the
main process, the compiler skips the directory, and an app without one gets a
generated window onto its page.

Configuration is ${CONFIG}, merged from the project root down to the app.`;

/** Config keys naming a path, resolved against the file that declared them. */
const PATH_KEYS = ["runtime", "runtimeRoot", "check"];

/**
 * Load an application's `info.json`, merging any further out that cover it. A
 * nearer file wins key by key, so a project holding several applications can
 * state once what they share — a theme, a version — and each one declares only
 * what is its own.
 *
 * Nothing above an application is required to have one: what the tool needs to
 * know about itself is in `DEFAULTS`, resolved against `HOME`. An `info.json`
 * describes an application, and never mosaic.
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
      else if (key === "libraries" || key === "frameworks") {
        config[key] = value.map((entry) => ({
          ...entry,
          input: path.resolve(dir, entry.input),
        }));
      } else config[key] = value;
    }
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
      JSON.stringify(
        {
          app_name: name,
          version: "0.1.0",
          author: "",
          main_file: `${SRC}/${ENTRY}`,
        },
        null,
        2,
      ) + "\n",

    [`${SRC}/main.mib`]: `<!-- ${name} — the page.

     The markup itself has no logic and no JavaScript: everything dynamic is a
     binding to the controller, which is AppController.js beside this file.

       <div styleName="box">        a class comes from styleName, never class
       <View styleName="box">       the same thing, spelled as a component
       {title}                      text bound to a controller property
       styleName="row {status}"     a binding inside an attribute value
       action="increment"           a click calls controller.increment()
       action="input:onInput"       any event, naming the method to call
       outlet="field"            hands the DOM node to controller.field
       <Card limit="3" />           another component; its import is emitted

     A component this page draws is a module of its own — Card.jsx beside this
     file — and naming it in the markup is all it takes: the compiler emits the
     import. There is one place a component is written, and one way to find it.

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

    [`${SRC}/${BUN_DIR}/${"index.js"}`]: `// ${name} — the native side, and what \`mosaic desktop\` runs as the main
// process. This directory is \`${BUN_DIR}/\` by convention: the compiler skips it,
// because none of it is browser code and none of it belongs in the bundle.
//
// It runs in Bun, not in the page. There is no DOM here and no application —
// what it does is open the window the page is drawn in, and whatever else has
// to be asked of the operating system: menus, a tray, dialogs, the file system.
//
// The page is reached as \`views://mainview/index.html\`. That is the view
// \`desktop\` generates, and index.html is the one this app was created with.
//
// Keep this directory self-contained. It is copied into the generated project
// whole, so a relative import reaching up out of it would not survive the move.
import { BrowserWindow } from "electrobun/bun";

new BrowserWindow({
  title: "${name}",
  url: "views://mainview/index.html",
  frame: { width: 1024, height: 768, x: 200, y: 200 },
});
`,

    "index.html": `<!doctype html>

<html lang="en">

<head>
    <meta charset="utf-8" />
    <title>${name}</title>

    <!-- Source Sans 3, the face the themes are drawn in. Everything still reads
         without it — the theme's stack falls back to the system face — so this
         is the one line to drop for an application that would rather not
         fetch a font. -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,300..700;1,300..700&amp;display=swap"
    />

    <!-- The page the application is drawn into. The document has no margin of
         its own and is the full height of the window, so a view that asks for
         100% gets the window rather than the height of its own content — which
         is what a split panel, a list frame and anything else that fills the
         page are measured against. The face is the one the themes are drawn
         in, stated here so the document carries it before any component does. -->
    <style>
        /* Both, so the browser's own furniture follows the theme rather than
           fighting it: form controls, scrollbars, the canvas behind the page
           and the flash before the first paint. Which of the two is in force
           is the reader's setting until a theme says otherwise. */
        :root {
            color-scheme: light dark;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            font-family: "Source Sans 3", sans-serif;
        }
    </style>
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
  const existing = Object.keys(files).filter((f) =>
    fs.existsSync(path.join(dir, f)),
  );
  if (existing.length > 0) {
    throw new Error(`${dir} already has ${existing.join(", ")}`);
  }

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  console.log(`created ${dir}`);
  for (const file of Object.keys(files)) console.log(`    ${file}`);
  console.log("");
  console.log(`    cd ${name} && mosaic server`);
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
    // The compiled modules the bundle was built from. They are intermediate:
    // the page loads the bundle and nothing else. `check` keeps them because
    // its page loads them unbundled, which is how the runtime is tested
    // against a real build with no bundler in the way.
    keepModules: false,
    // Off by default: a build is read while it is being worked on, and the
    // bundle is the thing you open when something looks wrong.
    minify: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      args.port = Number(argv[++i]);
      if (!Number.isInteger(args.port))
        throw new Error("`--port` needs a number");
    } else if (a === "--page") {
      args.page = argv[++i];
      if (!args.page) throw new Error("`--page` needs a path");
    } else if (a === "--no-open") args.open = false;
    else if (a === "--no-watch") args.watch = false;
    else if (a === "--no-sourcemap") args.sourcemap = false;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--keep-modules") args.keepModules = true;
    else if (a === "--minify") args.minify = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith("-")) throw new Error(`unknown option \`${a}\``);
    else if (!args.command) args.command = a;
    // `dev` and `prod` say how a run is meant rather than where it is. A
    // directory of either name is still reachable as `./dev`.
    else if (MODES.includes(a) && !args.mode) args.mode = a;
    else if (!args.entry) args.entry = a;
    else throw new Error(`unexpected argument \`${a}\``);
  }

  if (!args.command) throw new Error("missing command");
  if (
    !["init", "install", "compile", "server", "desktop", "check", "clean"].includes(
      args.command,
    )
  ) {
    throw new Error(`unknown command \`${args.command}\``);
  }
  if (args.command === "init" && !args.entry)
    throw new Error("`init` needs a name");

  // Only the two commands that run an application have anything to say about
  // how. Silently accepting `mosaic compile prod` would be promising something.
  if (args.mode && !MODE_COMMANDS.includes(args.command)) {
    throw new Error(
      `\`${args.command}\` takes no mode — that is for ` +
        `${MODE_COMMANDS.map((c) => `\`${c}\``).join(" and ")}`,
    );
  }
  if (MODE_COMMANDS.includes(args.command)) args.mode ??= "dev";
  if (args.mode === "prod") {
    throw new Error(
      `\`${args.command} prod\` is not implemented yet — only \`dev\``,
    );
  }

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
    throw new Error(
      `${CONFIG} names main_file "${config.main_file}", which is not in ${source}`,
    );
  }

  // What the compiler walks. `main_file` names the bootstrap, and the tree it
  // sits in is the application's code: everything beside it and below it, and
  // nothing above. That is what lets `info.json` sit above the sources —
  // at the top of a project whose root also holds a `node_modules/` or a
  // build directory belonging to something else — without the walk reaching
  // any of it.
  const sourceRoot = path.dirname(main);

  return {
    source,
    sourceRoot,
    // The native side, by convention: a `bun/` beside `main.js` is the
    // Electrobun main process. The compiler skips it — it is not browser code
    // and never belongs in the bundle — and `desktop` runs it.
    bunDir: path.join(sourceRoot, BUN_DIR),
    name: path.basename(source),
    outdir,
    // The bootstrap keeps its place in the compiled tree, which is now rooted
    // at `main_file`'s directory: `src/main.js` compiles to `build/main.js`.
    // The bundle sits at the top of the build either way: it is what the page
    // loads, and has no source position to keep.
    entry: path.join(outdir, path.relative(sourceRoot, main)),
    outfile: path.join(outdir, "app.js"),
  };
}

/**
 * The same application, built somewhere else.
 *
 * A build is written into a directory beside the real one and moved into place
 * whole, which is what makes it all-or-nothing: a compile that fails, or is
 * killed halfway, leaves the last good build exactly where it was rather than a
 * tree that is half this run and half the one before. Reading a partial build
 * is what "it worked a minute ago" is made of, and it costs an afternoon to
 * recognise — the files are all *there*, just not all from the same run.
 *
 * The staging directory sits beside the real one so the two are on the same
 * filesystem and the move is a rename. It is the same depth, so every relative
 * path a compiled module or a source map holds is right before and after.
 */
function staged(app) {
  clearAbandoned(app.outdir);
  const staging = `${app.outdir}.building-${process.pid}`;
  return {
    ...app,
    outdir: staging,
    entry: path.join(staging, path.relative(app.outdir, app.entry)),
    outfile: path.join(staging, path.relative(app.outdir, app.outfile)),
    /** Where it is going, for the messages that name it. */
    finalOutdir: app.outdir,
  };
}

/**
 * The directories a build occupies: the one it lands in, and the two it passes
 * through on the way — staging, and what a swap moves aside.
 *
 * Said in one place because two things have to agree about it, and when they
 * did not it was expensive: `server` watches the application directory and the
 * build sits inside it, so a staging directory the watcher did not recognise
 * looked exactly like someone editing. Every rebuild started another, and a
 * single keystroke rebuilt for ever.
 */
const STAGING = /^(building|previous)-\d+$/;

/** Whether `name` is a staging sibling of a build directory called `base`. */
function isStaging(base, name) {
  return (
    name.startsWith(`${base}.`) && STAGING.test(name.slice(base.length + 1))
  );
}

/**
 * Whether the run that made a staging directory is still going.
 *
 * Its name carries the process it belongs to, which is what makes this
 * answerable: signal 0 asks after a process without sending it anything.
 * Deleting a directory a live build is writing into is how a build ends up
 * reading a file that was there a moment ago and is not there now.
 */
function stagingIsLive(name) {
  const pid = Number(name.slice(name.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid) || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Alive, but not ours to signal — which is still alive.
    return e?.code === "EPERM";
  }
}

/** Whether `full` is the build at `outdir`, or inside it, or inside its staging. */
function inBuild(outdir, full) {
  if (full === outdir || full.startsWith(outdir + path.sep)) return true;

  const parent = path.dirname(outdir);
  if (!full.startsWith(parent + path.sep)) return false;
  const first = full.slice(parent.length + 1).split(path.sep)[0];
  return isStaging(path.basename(outdir), first);
}

/**
 * Delete staging left behind by a run that was killed before it could finish —
 * a Ctrl-C, a terminal closed, a machine that went down mid-build.
 *
 * Nothing is lost with them: a staged build was never in use, and the one this
 * run is about to make replaces whatever they were going to be.
 */
function clearAbandoned(outdir) {
  const dir = path.dirname(outdir);
  const base = path.basename(outdir);
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir)) {
    if (!isStaging(base, entry)) continue;
    // Left by a run that is still going, not an abandoned one.
    if (stagingIsLive(entry)) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Put a staged build in place of the real one, and give back what was there so
 * it can be deleted once nothing is reading it.
 */
function swapIntoPlace(build) {
  const target = build.finalOutdir;
  const previous = `${target}.previous-${process.pid}`;

  if (fs.existsSync(target)) fs.renameSync(target, previous);
  try {
    fs.renameSync(build.outdir, target);
  } catch (e) {
    // Put back what was there rather than leaving the application with none.
    if (fs.existsSync(previous)) fs.renameSync(previous, target);
    throw e;
  }

  // The generated desktop project is carried across. It sits in the build
  // directory but is not of the build: it holds the dependencies `desktop`
  // installed, and a compile that threw them away would charge every rebuild
  // an install for a page that changed.
  const carried = path.join(previous, DESKTOP_DIR);
  if (fs.existsSync(carried) && !fs.existsSync(path.join(target, DESKTOP_DIR))) {
    fs.renameSync(carried, path.join(target, DESKTOP_DIR));
  }

  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
}

/**
 * Copy the runtime tree into the app's build as a package, so compiled code can
 * import it by name: `import { MosaicApplication } from "mosaic"`, and each
 * framework compiled into it as a subpath of the same package:
 * `import { Button } from "mosaic/frameworks/ui"`.
 *
 * It lands in `build/node_modules/mosaic/`, which is the one layout every
 * resolver already understands — Bun's bundler and node find it with no
 * configuration, and a browser needs only the import map the host page carries.
 * Vendoring is also what lets `server` serve the app as its root: a module
 * reaching `../../src/...` would be reaching outside what the app ships.
 */
function vendorRuntime(config, app) {
  const root = config.runtimeRoot;
  const runtime = config.runtime;
  if (!runtime.startsWith(root + path.sep)) {
    throw new Error(`runtime ${runtime} is not inside runtimeRoot ${root}`);
  }

  // The runtime is read from disk, so an installed mosaic that cannot find the
  // tree it was installed with can say so in those terms — rather than failing
  // on a path nobody wrote, somewhere inside the executable.
  if (!fs.existsSync(root)) {
    throw new Error(
      `mosaic cannot find its runtime at ${root}.\n` +
        `    It looked in ${HOME}, which is ${homeSource()}.\n` +
        `    Reinstall with \`make install\`, or set MOSAIC_HOME to a mosaic checkout.`,
    );
  }

  const name = config.runtimeSpecifier;
  const dest = path.join(app.outdir, "node_modules", name);
  const main = "./" + path.relative(root, runtime).split(path.sep).join("/");

  // The compiler is not part of the runtime and has no business being served.
  // Framework sources are left out too: they are compiled into this package
  // rather than copied, so the only copy of a component is the compiled one.
  const skipped = new Set([
    path.resolve(root, "compiler"),
    ...config.frameworks.map((f) => f.input),
  ]);
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (src) => !skipped.has(path.resolve(src)),
  });

  // A framework is reached as `mosaic/frameworks/<name>`, through the index the
  // build writes for it. Declaring the subpaths one by one — rather than a
  // `./frameworks/*` pattern — keeps the package honest about what it has.
  const exports = { ".": main };
  for (const framework of config.frameworks) {
    exports[`./${FRAMEWORKS}/${framework.name}`] =
      `./${FRAMEWORKS}/${framework.name}/index.js`;
    // And each component by its own path within the framework, which is how
    // compiled markup names one: a `<Button/>` asks for Button and should
    // bring in Button, not the index that names every component there is.
    exports[`./${FRAMEWORKS}/${framework.name}/*`] =
      `./${FRAMEWORKS}/${framework.name}/*`;
  }

  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify(
      {
        name,
        version: config.version,
        ...(config.author ? { author: config.author } : {}),
        type: "module",
        main,
        exports,
        // A component's module injects its stylesheet when it loads,
        // which reads as a side effect and stops a bundler dropping a
        // component nothing uses. The stylesheet is only wanted by the
        // component, so dropping the two together is right: saying so
        // here is what lets an application carry only what it imports.
        //
        // A theme is the exception. It is nobody's component and every
        // component's colours, so it is named here as the one thing whose
        // side effect — writing the stylesheet into the document — must
        // survive an application that never mentions it.
        sideEffects: [`./${FRAMEWORKS}/*/theme.js`],
      },
      null,
      2,
    ) + "\n",
  );
  return { specifier: name, main: path.join(dest, main), dest };
}

/**
 * The frameworks, resolved into this application's build: each one a source
 * tree compiled into the vendored package, and the specifier its components
 * are imported by.
 */
function frameworkSources(config, app) {
  const root = path.join(
    app.outdir,
    "node_modules",
    config.runtimeSpecifier,
    FRAMEWORKS,
  );

  return config.frameworks.map((framework) => ({
    name: framework.name,
    input: framework.input,
    outdir: path.join(root, framework.name),
    specifier: `${config.runtimeSpecifier}/${FRAMEWORKS}/${framework.name}`,
    themes: path.join(framework.input, THEMES),
  }));
}

/** The themes a framework offers: every stylesheet in its `themes/`. */
function themeNames(framework) {
  if (!fs.existsSync(framework.themes)) return [];
  return fs
    .readdirSync(framework.themes)
    .filter((file) => path.extname(file) === ".css")
    .map((file) => path.basename(file, ".css"))
    .sort();
}

/**
 * Write the module that carries a framework's theme, and return its specifier.
 *
 * A theme is a stylesheet of custom properties the components read — which one
 * is the application's choice, so no component names it. `theme` in info.json
 * picks it, this inlines it, and the framework's index imports it: reaching the
 * framework at all brings its theme along, and there is nothing to link in a
 * page.
 *
 * The stylesheet is global by nature — `:global(:root)` is where the variables
 * are declared — so it is emitted with no scope suffix, which unwraps the
 * `:global(...)` the compiler would have.
 */
function writeFrameworkTheme(config, framework, options = {}) {
  const available = themeNames(framework);
  if (available.length === 0) return null;

  const chosen = config.theme;
  if (!chosen) return null;

  // What the build carries. One theme is the usual case and costs one
  // stylesheet; naming more in `themes` is what lets a page switch between
  // them at run time, and each one named is in the bundle whether it is worn
  // or not.
  const named = [...new Set([chosen, ...(config.themes ?? [])])];
  for (const name of named) {
    if (!available.includes(name)) {
      throw new Error(
        `${CONFIG} names theme "${name}", which ${framework.name} does not have — ` +
          `it offers ${available.join(", ")}`,
      );
    }
  }

  // And the dark counterpart of each, unasked: a theme named `aristo` with an
  // `aristo_dark` beside it is one theme in two lights, and a page that
  // carried only the light one could not follow a reader who prefers the dark.
  // It costs a stylesheet, and only for a theme that has a counterpart at all.
  //
  // Unless the application would rather be one way whatever the reader
  // prefers, which is what `disable_dark_theme` says. Then a counterpart is
  // carried only if it was named outright, and nothing follows the system.
  const pairs = {};
  const bundled = [...named];
  for (const name of config.disable_dark_theme ? [] : named) {
    const dark = `${name}${DARK_SUFFIX}`;
    if (name.endsWith(DARK_SUFFIX) || !available.includes(dark)) continue;
    pairs[name] = dark;
    if (!bundled.includes(dark)) bundled.push(dark);
  }

  // Unscoped — a theme's selectors mean what they say — but prefixed with
  // `:root`, which buys back the specificity a component's stylesheet gets
  // from its scope class. Without it a theme could restyle nothing a
  // component had an opinion about.
  const sheets = bundled.map((name) => [
    name,
    scopeCss(
      fs.readFileSync(path.join(framework.themes, `${name}.css`), "utf8"),
      "",
      ":root",
      { minify: options.minify },
    ).trimEnd(),
  ]);

  const module = path.join(framework.outdir, THEME_MODULE);
  const entries = sheets
    .map(([name, css]) => `  ${JSON.stringify(name)}: ${JSON.stringify(css)},`)
    .join("\n");

  // One <style> element, rewritten rather than added to: a theme replaces the
  // one before it, so switching cannot leave two of them fighting. It is
  // appended when this module is imported, which the index does last — so the
  // theme sits after the stylesheets it restyles.
  const source = `// ${framework.name} — generated by mosaic from ${CONFIG}.
//
// The themes this build carries, and how one is worn. \`theme\` names the one
// the page starts in; \`setTheme\` swaps it, which is a stylesheet swap and
// nothing else — no component is redrawn and no state is touched.
//
// A theme with a dark counterpart is worn in whichever light the reader has
// asked their system for, and follows it if they change their mind while the
// page is open. Choosing one by hand ends that: an application that says which
// theme it wants has said so, and a preference the reader expressed to their
// operating system does not overrule a preference they expressed to the
// application.

const SHEETS = {
${entries}
};

/** The themes in this build, in the order ${CONFIG} named them. */
export const themes = Object.keys(SHEETS);

/** The one being worn. */
export let theme = ${JSON.stringify(chosen)};

/** Light theme -> the dark one beside it, for those that have one. */
const DARK = ${JSON.stringify(pairs)};
const LIGHT = Object.fromEntries(Object.entries(DARK).map(([l, d]) => [d, l]));

const darkness =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null;

/** \`name\` as the reader's system would have it, if it comes in two lights. */
function asPreferred(name) {
  const light = LIGHT[name] ?? name;
  const dark = DARK[light];
  if (!dark) return name;
  return darkness?.matches ? dark : light;
}

const element = typeof document === "undefined" ? null : document.createElement("style");
if (element) {
  element.setAttribute("data-mosaic-theme", ${JSON.stringify(framework.name)});
  document.head.appendChild(element);
}

/**
 * Wear \`name\`. Unknown names are refused rather than silently ignored.
 *
 * Said by the application, this settles it: the page stops following the
 * reader's system setting, since a theme asked for by name is a decision and
 * the system's is only a default. \`followSystem()\` hands it back.
 */
export function setTheme(name) {
  following = false;
  return wear(name);
}

/** Which of the two lights the reader's system is asking for. */
export function systemTheme(name = theme) {
  return asPreferred(name);
}

/**
 * Go back to wearing whichever light the system asks for, and following it.
 * What the page does until something calls \`setTheme\`.
 */
export function followSystem() {
  following = true;
  return wear(asPreferred(theme));
}

let following = true;

function wear(name) {
  if (!(name in SHEETS)) {
    throw new Error(\`no theme "\${name}" in this build — it carries \${themes.join(", ")}\`);
  }
  theme = name;
  if (element) element.textContent = SHEETS[name];
  return name;
}

darkness?.addEventListener?.("change", () => {
  if (following) wear(asPreferred(theme));
});

wear(asPreferred(theme));
`;

  fs.mkdirSync(path.dirname(module), { recursive: true });
  fs.writeFileSync(module, source);
  return { name: chosen, module, bundled };
}

/**
 * Whether anything outside `framework` imports it — a component named in
 * markup, a class imported in JavaScript, anything at all.
 *
 * A theme is only worth carrying for an application that draws with the
 * framework it belongs to; one that draws none of it would be given a
 * stylesheet nothing reads. The framework's own modules are not asked, since
 * they import each other whatever the application does.
 *
 * @param {object} framework The framework and where it was compiled to.
 * @param {string[]} written Every module this build compiled.
 * @param {string[]} own The ones that are the framework's.
 * @returns {boolean} Whether the application reaches into it.
 */
function usesFramework(framework, written, own) {
  const theirs = new Set(own);

  return written.some((module) => {
    if (theirs.has(module)) return false;
    // The specifier as an import would write it: `"mosaic/frameworks/ui"`
    // for the index, and `"mosaic/frameworks/ui/…"` for a component reached
    // by its own path, which is how a compiled tag names one.
    return fs.readFileSync(module, "utf8").includes(`"${framework.specifier}`);
  });
}

/**
 * Make the application's bootstrap import the themes, so the bundle carries the
 * one `info.json` named whether or not a line of the application ever mentions
 * it.
 *
 * A theme belongs to the application, not to any component: no component names
 * one, which is what leaves nothing in the import graph to pull it in. An
 * application that imports the framework index for a Button would carry the
 * theme through it; one that imports a component by its own path, or that draws
 * nothing from the framework at all and only reads the theme's custom properties
 * in its own stylesheet, would end up with every `var(--…)` resolving to
 * nothing — the components would draw, colourless.
 *
 * The bootstrap is compiled output, rewritten on every build, so this is a line
 * added to a generated file rather than to anything anyone wrote.
 *
 * @param {object} app The application's layout, whose `entry` is the bootstrap.
 * @param {string[]} specifiers The theme modules to import, one per framework.
 */
function linkThemes(app, specifiers) {
  if (specifiers.length === 0) return;

  const imports = specifiers
    .map((specifier) => `import ${JSON.stringify(specifier)};`)
    .join("\n");

  // Written last, not first. Imports are evaluated in the order they are
  // written, and a theme has to be worn after the stylesheets it restyles:
  // two rules of equal weight are settled by which came later. Linking it at
  // the top of the bootstrap puts its <style> element before every
  // component's, and the theme loses every argument it was meant to win.
  const source = fs.readFileSync(app.entry, "utf8");
  fs.writeFileSync(
    app.entry,
    `${source.trimEnd()}\n\n// The theme ${CONFIG} named, linked in by mosaic: a theme is the\n` +
      `// application's, and nothing imports it by hand.\n${imports}\n`,
  );
}

/**
 * Write a framework's index: the module its subpath export names, re-exporting
 * every component compiled into it.
 *
 * A component module's default export is the component, named for its file, so
 * `button/Button.js` is what `import {Button} from "mosaic/frameworks/ui"`
 * gets. Whatever else a module exports by name comes along with it — `Intent`
 * and `ButtonState` are as much part of the framework as `Button` is.
 */
function writeFrameworkIndex(framework, modules, theme) {
  const lines = [
    `// ${framework.name} — generated by mosaic. What "${framework.specifier}" exports.`,
    "",
  ];

  for (const module of [...modules].sort()) {
    const specifier =
      "./" + path.relative(framework.outdir, module).split(path.sep).join("/");
    const name = componentName(path.basename(module, path.extname(module)));
    const source = fs.readFileSync(module, "utf8");

    if (/^\s*export\s+default\b/m.test(source)) {
      lines.push(
        `export {default as ${name}} from ${JSON.stringify(specifier)};`,
      );
    }
    lines.push(`export * from ${JSON.stringify(specifier)};`);
  }

  // Last, so the theme's rules land after the stylesheets they restyle: two
  // rules of equal weight are settled by which came later, and a theme is
  // meant to win. It is what `ensureInjectedAtStart()` arranges from the
  // other end in the Java original.
  if (theme) {
    lines.push(
      "",
      `// The "${theme.name}" theme, which ${CONFIG} chose, and the`,
    );
    lines.push(
      `// others this build carries: \`setTheme\` swaps between them.`,
    );
    lines.push(`export {theme, themes, setTheme} from "./theme.js";`);
  }

  const index = path.join(framework.outdir, "index.js");
  fs.writeFileSync(index, lines.join("\n") + "\n");
  return index;
}

/**
 * Report a failure. The message is the line to read; the stack below it says
 * where it came from, which is what tells a bug in the tool apart from a
 * mistake in the sources it was given. A cause chain is followed to the end.
 */
function report(e) {
  console.error(`mosaic: ${e?.message ?? e}`);
  if (e?.stack) console.error(e.stack);
  for (let cause = e?.cause; cause; cause = cause.cause) {
    console.error(`caused by: ${cause.message ?? cause}`);
    if (cause.stack) console.error(cause.stack);
  }
}

/**
 * Where an icon named `svg:chevron-down` is looked for, nearest first: the
 * application's own `src/icons/`, then each framework's, which is beside the
 * themes that colour them. An application can shadow an icon the framework
 * ships by putting one of the same name in its own directory.
 */
function iconDirs(config, app) {
  return [
    path.join(app.source, SRC, "icons"),
    ...config.frameworks.map((framework) => path.join(framework.input, ICONS)),
  ].filter((dir) => fs.existsSync(dir));
}

/** The library trees, resolved into this application's build directory. */
function librarySources(config, app) {
  return config.libraries.map((lib) => ({
    input: lib.input,
    outdir: path.join(app.outdir, lib.outdir),
  }));
}

/** Compile the frameworks, the libraries and the application, then bundle. */
async function compile(config, app, args) {
  // Everything below writes into a staging directory; the last thing this does
  // is move it into place. Nothing reads a build that is half-written, and a
  // run that throws leaves the previous one untouched.
  const build = staged(app);
  try {
    await compileInto(config, build, args);
  } catch (e) {
    fs.rmSync(build.outdir, { recursive: true, force: true });
    throw e;
  }
  swapIntoPlace(build);
}

async function compileInto(config, app, args) {
  const log = args.quiet ? () => {} : (...a) => console.log(...a);
  // A build is written into a staging directory and moved into place at the
  // end, which is this run's business and not the reader's: paths are reported
  // as where they will be, not where they are for the moment.
  const settled = (p) =>
    app.finalOutdir ? p.split(app.outdir).join(app.finalOutdir) : p;
  const relative = (p) => path.relative(config.root, settled(p)) || ".";

  const frameworks = frameworkSources(config, app);
  const sources = [
    // A framework compiles into the vendored package, and its components are
    // imported by the name that package exports them under rather than by a
    // path — `mosaic/frameworks/ui`, wherever the importing module sits.
    ...frameworks.map((f) => ({
      input: f.input,
      outdir: f.outdir,
      specifier: f.specifier,
    })),
    ...librarySources(config, app),
    { input: relative(app.sourceRoot), outdir: app.outdir },
  ];

  // Nothing to clear: this run writes into a directory of its own, which is
  // what makes a renamed or deleted source unable to leave a stale module
  // behind — there is nothing here from any earlier run to leave.
  const vendored = vendorRuntime(config, app);

  log(`==> compiling ${relative(app.sourceRoot)}`);
  const written = compileAll(sources, {
    // Not source. The build this run will end up as — it is not written to
    // during the run, the staging directory is, so it has to be named or the
    // build sitting there from last time is walked as source — and the `bun/`
    // holding the native side, which is a program of its own and is compiled
    // by nothing here.
    skip: [...(app.finalOutdir ? [app.finalOutdir] : []), app.bunDir],
    runtime: vendored.specifier,
    // Where `import X from "svg:name"` looks: the application's own icons
    // first, so an app can replace one the framework ships.
    icons: iconDirs(config, app),
    sourcemap: args.sourcemap,
    // A stylesheet rides into the bundle as a string, where the bundler's own
    // minifier cannot see its comments. The compiler drops them instead.
    minify: args.minify,
    onFile: args.quiet
      ? undefined
      : (src, dest) => log(`    ${src} -> ${settled(dest)}`),
  });
  log(`    ${written.length} modules`);

  // Each framework's index is written from what actually compiled into it, so
  // adding a component to the tree is all it takes to export one.
  const themes = [];
  for (const framework of frameworks) {
    const modules = written.filter((dest) =>
      path.resolve(dest).startsWith(path.resolve(framework.outdir) + path.sep),
    );
    const theme = writeFrameworkTheme(config, framework, {
      minify: args.minify,
    });
    const index = writeFrameworkIndex(framework, modules, theme);
    const themed = theme
      ? `, ${theme.name} theme` +
        (theme.bundled.length > 1
          ? ` (+${theme.bundled.length - 1} to switch to)`
          : "")
      : "";
    log(
      `    ${framework.specifier} -> ${settled(index)}  (${modules.length} modules${themed})`,
    );
    if (theme && usesFramework(framework, written, modules)) {
      themes.push(`${framework.specifier}/${THEME_MODULE}`);
    }
  }

  linkThemes(app, themes);

  log("==> bundling");
  // `throw: false`: a thrown build carries only "Bundle failed", and the
  // messages that say which import went unresolved are what is worth seeing.
  const result = await Bun.build({
    entrypoints: [app.entry],
    sourcemap: args.sourcemap ? "linked" : "none",
    target: "browser",
    // What is served is the bundle, so this is the one place minifying
    // belongs: the compiled modules stay readable, and a source map still
    // leads back to the `.mib` a name came from.
    minify: args.minify,
    throw: false,
  });
  if (!result.success) {
    // The message alone says what failed but not where: an unresolved import
    // names the specifier, and the position names the file that wrote it.
    for (const message of result.logs) {
      console.error(`    ${message}`);
      const at = message?.position;
      if (at) {
        console.error(`      ${relative(at.file)}:${at.line}:${at.column}`);
        if (at.lineText) console.error(`        ${at.lineText.trim()}`);
      }
      if (message?.stack) console.error(message.stack);
    }
    throw new Error(`could not bundle ${app.entry}`);
  }

  // The artifacts are written here rather than through the bundler's own
  // `outdir`: a build that reports success has to leave a bundle behind, and
  // writing it is the only way to be sure of it.
  await writeBundle(result.outputs, app);

  const bytes = fs.statSync(app.outfile).size;
  log(
    `    ${settled(app.outfile)}  ${(bytes / 1024).toFixed(1)} KB${args.minify ? ", minified" : ""}`,
  );

  if (!(args.keepModules || args.command === "check")) {
    const removed = pruneModules(app);
    if (removed > 0) log(`    ${removed} intermediate modules removed`);
  }
}

/**
 * Write what the bundler produced: the bundle at `app.outfile`, its source map
 * beside it, and anything else under the same directory.
 */
async function writeBundle(outputs, app) {
  const dir = path.dirname(app.outfile);
  fs.mkdirSync(dir, { recursive: true });

  let wroteBundle = false;
  for (const output of outputs) {
    const name =
      output.kind === "entry-point"
        ? path.basename(app.outfile)
        : output.kind === "sourcemap"
          ? `${path.basename(app.outfile)}.map`
          : path.basename(output.path);

    fs.writeFileSync(
      path.join(dir, name),
      Buffer.from(await output.arrayBuffer()),
    );
    if (output.kind === "entry-point") wroteBundle = true;
  }

  if (!wroteBundle || !fs.existsSync(app.outfile)) {
    throw new Error(
      `the bundle is missing at ${app.outfile} — the build produced none`,
    );
  }
}


/**
 * Delete everything in the build but the bundle and its map.
 *
 * The compiled modules are what the bundle was built *from*: every one of them
 * is inside it, and the page loads it alone. Leaving them would ship a second
 * copy of the application beside the one being served — and, in `server`, one a
 * page could reach behind the bundle's back.
 *
 * The map is unaffected: Bun writes the sources into it, so the bundle stays
 * debuggable with nothing beside it.
 */
function pruneModules(app) {
  const keep = new Set(
    [app.outfile, `${app.outfile}.map`].map((p) => path.resolve(p)),
  );

  let removed = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (!keep.has(path.resolve(full))) {
        fs.rmSync(full);
        removed++;
      }
    }
  };
  walk(app.outdir);
  return removed;
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
/** Where a checked page posts its verdict back to. */
const RESULT_PATH = "/__mosaic-check";

/**
 * The script the server adds to a checked page.
 *
 * A page says when it is finished; nothing here guesses. It waits for the
 * verdict the page writes into its title, then posts that and the results
 * back — which is what `check` is waiting for. Without it the browser has to
 * be asked for the DOM at some arbitrary moment, and a page whose bundle was
 * still loading reads as every check failing at once.
 */
const REPORTER = `<script>
(() => {
  const done = (verdict) => fetch(${JSON.stringify(RESULT_PATH)}, {
    method: "POST",
    body: JSON.stringify({
      title: document.title,
      results: document.querySelector("#results")?.textContent ?? "",
      verdict,
    }),
  });
  let waited = 0;
  const look = () => {
    if (/verdict/i.test(document.title)) return done("reported");
    if ((waited += 50) > 30000) return done("timed out");
    setTimeout(look, 50);
  };
  look();
})();
</script>`;

function serve(root, port, onResult = null) {
  const base = path.resolve(root);

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === RESULT_PATH) {
        if (onResult) onResult(await request.json());
        return new Response(null, { status: 204 });
      }

      let target = path.join(base, decodeURIComponent(url.pathname));

      // Nothing outside the served root, whatever the path claims.
      if (target !== base && !target.startsWith(base + path.sep)) {
        return new Response("forbidden", { status: 403 });
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, "index.html");
      }

      const file = Bun.file(target);
      if (!(await file.exists()))
        return new Response("not found", { status: 404 });

      const type = CONTENT_TYPES[path.extname(target)];
      const headers = {
        // Always revalidate: the point of `server` is that a rebuild is visible.
        "cache-control": "no-store",
        ...(type ? { "content-type": type } : {}),
      };

      // A page being checked reports back when it is done. Nothing is added to
      // a page `server` serves: an application should be what it is.
      //
      // Appended rather than spliced into `</body>`: a page is not required to
      // have one, and a check page that ends at its last <script> would
      // otherwise be served without a way to report.
      if (onResult && path.extname(target) === ".html") {
        return new Response((await file.text()) + `\n${REPORTER}\n`, {
          headers,
        });
      }

      return new Response(file, { headers });
    },
  });
}

/**
 * Show a URL in whatever browser this machine has.
 *
 * @param {string} url What to open.
 * @returns {boolean} Whether anything was found to open it with.
 */
function open(url) {
  for (const cmd of [
    "xdg-open",
    "open",
    "chromium",
    "google-chrome",
    "firefox",
  ]) {
    if (!Bun.which(cmd)) continue;
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
    return true;
  }
  return false;
}

/**
 * Open the check page in headless Chromium and wait for its verdict.
 *
 * A page writes `verdict PASS` or `verdict FAIL` into its title once its
 * assertions have run, and the reporter the server adds posts that back. The
 * run ends when the page says it is finished — never before, however long its
 * bundle took to load.
 */
async function check(page, root, port, reported) {
  const browser = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "brave",
  ].find((b) => Bun.which(b));
  if (!browser) throw new Error("no chromium-like browser found");

  const url = `http://127.0.0.1:${port}/${path.relative(root, page).split(path.sep).join("/")}`;

  // A profile of its own, thrown away afterwards. The server takes whatever
  // port it is given, so a run can land on one a previous run used — and a
  // browser that kept its cache would answer from what that other run
  // served, which is a build ago.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-check-"));

  const proc = Bun.spawn(
    [
      browser,
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${profile}`,
      "--disk-cache-size=1",
      url,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );

  // The page says when it is done, and this waits for it to say so. Asking
  // the browser for the DOM at a moment of its choosing was the alternative,
  // and it read a page whose bundle was still loading as a page whose every
  // check had failed.
  let result;
  try {
    result = await Promise.race([reported, Bun.sleep(60000).then(() => null)]);
  } finally {
    proc.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }

  if (!result) {
    console.error(`==> browser check never reported back — open ${url}`);
    return 1;
  }

  if (process.env.MOSAIC_RAW)
    console.error("RAW:", JSON.stringify(result).slice(0, 1200));
  for (const line of (result.results ?? "").split("\n")) {
    if (/^\s*(PASS|FAIL|ERROR)/.test(line)) console.log(line.trim());
  }

  // The verdict is the page's own, taken from the title it set.
  const title = result.title ?? "";
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
 * Everything the build reads is watched — the application, the frameworks and
 * libraries it compiles against and the runtime it is vendored from — a change in
 * any of them makes what is being served stale. The build directory is not:
 * writing to it is what a rebuild *does*, and watching it would never settle.
 *
 * The server keeps running throughout. It reads from disk on every request, so
 * a finished rebuild is live at the next reload with nothing to restart.
 */
/**
 * Until when the watcher should disregard what it sees.
 *
 * A restart copies the application's `bun/` into the generated project, and
 * reading a directory to copy it is enough for the filesystem to report the
 * directory as changed. The watcher cannot tell that report from an edit — so
 * it would rebuild, and restart, and copy again, for ever. One edit was
 * observed to cost nine restarts before this.
 *
 * The window is around the copy itself and not the whole restart, which takes
 * as long as building a desktop app: an edit made while the app is relaunching
 * is a real edit and still counts.
 */
let watchBlindUntil = 0;
function suppressWatch(ms) {
  watchBlindUntil = Date.now() + ms;
}

function watchSources(config, app, args, onRebuilt = null) {
  const roots = [
    app.sourceRoot,
    config.runtimeRoot,
    ...config.frameworks.map((f) => f.input),
    ...config.libraries.map((lib) => lib.input),
  ];

  // A tree already covered by an ancestor is watched twice otherwise.
  const covered = (dir) =>
    roots.some((other) => other !== dir && dir.startsWith(other + path.sep));
  const watched = [...new Set(roots)].filter(
    (dir) => fs.existsSync(dir) && !covered(dir),
  );

  const outdir = path.resolve(app.outdir);
  const ignored = (root, file) => {
    if (!file) return true;
    // What a restart's own copying stirs up is not an edit.
    if (Date.now() < watchBlindUntil) return true;
    const full = path.resolve(root, file);
    // Editors write backups and swap files beside the real one.
    if (path.basename(file).startsWith(".") || file.endsWith("~")) return true;
    // And a build is not an edit — including the directories it is staged in,
    // which sit beside the build rather than inside it.
    return inBuild(outdir, full);
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
      await compile(config, app, { ...args, quiet: true });
      console.log(`    rebuilt in ${Date.now() - started}ms`);
      // What was built has to be picked up by whatever is running it. A server
      // reads from disk and needs nothing; a desktop app is a process holding
      // the old build in memory, and is restarted onto the new one.
      if (onRebuilt) await onRebuilt();
    } catch (e) {
      // A broken source is the normal case while editing: report it and keep
      // watching, rather than taking the server down with it.
      report(e);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        rebuild();
      }
    }
  };

  for (const root of watched) {
    fs.watch(root, { recursive: true }, (event, file) => {
      if (ignored(root, file)) return;
      // One edit can arrive as several events; wait for the flurry to stop.
      clearTimeout(timer);
      timer = setTimeout(rebuild, 60);
    });
  }

  return watched;
}

/**
 * Install what the application says it depends on.
 *
 * `bun install`, with `dependencies` in `info.json` standing in for the
 * package.json an application does not have. It is the same install `desktop`
 * does for itself, said as a command — for the first checkout of a project, for
 * a CI step that wants the download over with before the build, and for
 * changing a version and having it take effect without running the app.
 *
 * Asked for, it is done: unlike the install `desktop` performs on its way to
 * launching, this one does not decide the dependencies look current and skip.
 */
async function install(config, app, args) {
  const dir = path.join(app.outdir, DESKTOP_DIR);
  const project = writeProject({ app, config, dir });
  const log = args.quiet ? null : (...a) => console.log(...a);

  // There is always something to install even when the application named
  // nothing: what a desktop app is built out of is not its own dependency, but
  // it does have to be here.
  log?.(`==> installing into ${path.relative(config.root, dir) || "."}`);
  await installDependencies({ ...project, needsInstall: true, log: null });

  const names = Object.keys(project.dependencies);
  log?.(`    ${names.length > 0 ? names.join(", ") : "nothing declared"}`);
  return 0;
}

/**
 * Run the application as a native desktop app.
 *
 * The Electrobun project is generated into the build directory and thrown away
 * with it: an application says it is a desktop app by depending on Electrobun
 * and, if it has a native side to speak of, by having a `bun/`. It does not
 * acquire a second configuration file, a second build directory, or a second
 * idea of where its sources are.
 *
 * Electrobun is spawned with this process's streams, so its output is this
 * command's output, and it is killed with it — Ctrl-C reaches the app because
 * the terminal signals the group, and the exit below covers every other way
 * this process can end.
 */
async function desktop(config, app, args) {
  const dir = path.join(app.outdir, DESKTOP_DIR);
  const project = writeProject({ app, config, dir });
  const log = args.quiet ? null : (...a) => console.log(...a);

  log?.(`==> desktop ${path.relative(config.root, dir) || "."}`);
  log?.(
    `    main process ${
      project.ownMain
        ? path.relative(config.root, path.join(app.bunDir, "index.js"))
        : `generated (no ${BUN_DIR}/ beside ${path.basename(app.entry)})`
    }`,
  );

  await installDependencies({ ...project, log });

  // The generated project holds what `dependencies` asked for, so it is looked
  // in first. Anything installed further up still counts: a project that keeps
  // its dependencies in a package.json of its own, as it may, is not required
  // to say them twice.
  const electrobun = findElectrobun(dir) ?? findElectrobun(app.source);
  if (!electrobun) {
    throw new Error(
      `Electrobun is missing from ${dir} after installing it.\n` +
        `    Delete that directory and run \`mosaic desktop\` again.`,
    );
  }

  // Electrobun's CLI is a script with a `node` shebang, and node is not what
  // any of this runs on: a project that has Electrobun has bun, and may well
  // have no node at all. Run it under bun when bun can be found, and fall back
  // to the shebang only when it cannot.
  const bun = Bun.which("bun");
  const command = bun ? [bun, electrobun, "dev"] : [electrobun, "dev"];

  const launch = () =>
    Bun.spawn(command, {
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

  let proc = launch();
  // A restart kills the app, and the app dying is otherwise how this command
  // ends. The difference has to be recorded, because the exit looks the same.
  let restarting = false;

  // The app is a child of this process and outlives it otherwise: a killed
  // `desktop` would leave a window on screen with nothing driving it.
  const stop = () => proc.kill();
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
  }

  if (!args.watch) return await proc.exited;

  // The window holds the build it was launched with, and no reload reaches
  // the main process: picking up an edit means running it again. The rebuild
  // has already happened by the time this is called.
  const restart = async () => {
    restarting = true;
    proc.kill();
    await proc.exited;
    // The generated project is written again, not reused: the page and the
    // native side are copies, and an edit to either is only in the copy once
    // it is made afresh. Copying `bun/` disturbs it enough to look like an
    // edit, so the watcher is blind for as long as that takes.
    suppressWatch(1000);
    writeProject({ app, config, dir });
    proc = launch();
    restarting = false;
    log?.("    restarted");
  };

  const watched = watchSources(config, app, args, restart);
  log?.(
    `    watching ${watched
      .map((d) => path.relative(config.root, d) || ".")
      .join(", ")}`,
  );
  log?.("    Ctrl-C to stop");

  // Quitting the app ends the command; being killed for a restart does not.
  for (;;) {
    const code = await proc.exited;
    if (!restarting) return code;
    // The restart replaces `proc`; wait for it to have done so.
    while (restarting) await Bun.sleep(20);
  }
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
    // Paths in the config are relative to the config that declared them, and
    // are absolute by now; the application's directory is where the rest of a
    // run is anchored.
    process.chdir(config.root);
    app = layout(config, source);
  } catch (e) {
    console.error(`mosaic: ${e.message}\n\n${USAGE}`);
    return 1;
  }

  if (args.command === "clean") {
    // Staging from a run that was killed goes too, so `clean` really does
    // leave nothing of any build behind.
    clearAbandoned(app.outdir);
    if (fs.existsSync(app.outdir)) {
      fs.rmSync(app.outdir, { recursive: true, force: true });
      console.log(`removed ${app.outdir}`);
    } else {
      console.log(`nothing to clean at ${app.outdir}`);
    }
    return 0;
  }

  // Installing is not building, and does not wait on a build: an application
  // whose dependencies are not there yet is exactly the one that cannot
  // compile, and telling it to compile first would be a circle.
  if (args.command === "install") {
    try {
      return await install(config, app, args);
    } catch (e) {
      report(e);
      return 1;
    }
  }

  try {
    await compile(config, app, args);
  } catch (e) {
    report(e);
    return 1;
  }

  if (args.command === "compile") return 0;

  if (args.command === "desktop") {
    try {
      return await desktop(config, app, args);
    } catch (e) {
      report(e);
      return 1;
    }
  }

  // `server` serves the application directory, so a page can only reach what
  // ships with the app. A check page is a test *of* an application, and reads
  // the build it produced, so it is served from far enough up to see both.
  let checkPage = null;
  let checkRoot = null;
  try {
    if (args.command === "check") {
      checkPage = args.page ? path.resolve(args.page) : config.check;
      if (!fs.existsSync(checkPage))
        throw new Error(`no check page at ${checkPage}`);
      const inApp = !path.relative(app.source, checkPage).startsWith("..");
      const bothInHome =
        !path.relative(HOME, checkPage).startsWith("..") &&
        !path.relative(HOME, app.source).startsWith("..");

      // The root is served for the length of the run, so it has to be a place
      // that holds both by design: the application itself, or the checkout when
      // this is mosaic testing one of its own examples. Anything else — most
      // often mosaic's built-in page against an application installed elsewhere
      // — would mean serving whatever directory happens to contain them both.
      if (!inApp && !bothInHome) {
        throw new Error(
          `check page ${checkPage} is not part of ${app.source}.\n` +
            `    Name a page inside the application with \`--page\`, or with ` +
            `"check" in its ${CONFIG}.`,
        );
      }
      checkRoot = inApp ? app.source : HOME;
    }
  } catch (e) {
    report(e);
    return 1;
  }

  // The checked page posts its verdict back through the server; this is what
  // `check` waits for, so a run finishes when the page is finished.
  let reportResult;
  const reported = new Promise((resolve) => (reportResult = resolve));

  let server =
    args.command === "check"
      ? serve(checkRoot, 0, reportResult)
      : serve(app.source, args.port);

  if (args.command === "check") {
    let code;
    try {
      code = await check(checkPage, checkRoot, server.port, reported);
    } catch (e) {
      report(e);
      code = 1;
    }
    server.stop(true);
    return code;
  }

  const url = `http://localhost:${server.port}/`;
  console.log(`==> serving ${url}`);
  if (args.watch) {
    // Put the server back on the same port after a rebuild. It reads from disk
    // on every request, so this changes nothing about what it answers — what it
    // does is make one thing true of both commands: `dev` runs the application
    // again after an edit, and there is no rule about which edits count.
    const restart = () => {
      const port = server.port;
      server.stop(true);
      server = serve(app.source, port);
    };
    const watched = watchSources(config, app, args, restart);
    console.log(
      `    watching ${watched.map((d) => path.relative(config.root, d) || ".").join(", ")}`,
    );
  }
  console.log("    Ctrl-C to stop");
  if (args.open) open(url);

  // Bun keeps the process alive while the server is listening.
  return null;
}

const code = await main(Bun.argv.slice(2));
if (code !== null) process.exit(code);
