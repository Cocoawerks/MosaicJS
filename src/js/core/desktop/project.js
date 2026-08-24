// The Electrobun project a `desktop` run builds on the fly.
//
// Nothing here is kept: the project is generated inside the application's build
// directory every time, from the application's own config and the bundle the
// compiler just produced. That is what makes `desktop` a way of *running* an
// application rather than a thing an application has to be — a mosaic app has a
// `main.js`, a page and an `info.json`, and none of them know that Electrobun
// exists.
//
// The main process is generated with the rest of it. An application does not
// write one: what would vary between two of them is a title and a window size,
// and both are in `info.json`.
//
// What an application does put in the `bun/` beside `main.js` is services — the
// modules a page calls. The compiler skips that directory, since none of it is
// browser code and none of it belongs in the bundle, and a service names
// neither Electrobun nor rpc, which is what lets the same file answer over the
// desktop bridge here and over HTTP under `mosaic web`.

import * as fs from "node:fs";
import * as path from "node:path";

import { findServices, registrySource } from "../../frameworks/rpc/services.js";

/** The directory holding the native side, beside `main.js`. By convention. */
export const BUN_DIR = "bun";
/**
 * Where the generated project goes, inside the application's build directory.
 *
 * A compile replaces that directory whole, and this is the one thing in it a
 * compile did not produce and must not discard: the dependencies installed
 * here are an application's, not a build's, and reinstalling them because a
 * `.ib.xml` changed would make every rebuild a download.
 */
export const DESKTOP_DIR = "desktop";
/**
 * The toolkit `desktop` builds on, pinned here because this is the only place
 * that knows or cares. An application never names it: `desktop` installs it
 * into the project it generates, the way the compiler vendors the runtime.
 */
const ELECTROBUN_VERSION = "1.18.1";
/** The module Electrobun runs as its main process, inside `BUN_DIR`. */
export const BUN_ENTRY = "index.js";
/** What Electrobun calls the view this generates. Fixed: there is one page. */
const VIEW = "mainview";
/**
 * Electrobun reads this filename and no other — the extension is not a claim
 * about the language, and what is written into it below is plain JavaScript.
 */
const CONFIG = "electrobun.config.ts";

/**
 * What `mosaic init desktop` writes, and what an application then owns.
 *
 * The main process is the author's: a window is the one part of a desktop app
 * whose look and behaviour is the application's own — its size, its chrome, its
 * menus, how many of them there are and when. Generating it meant an
 * application could have exactly the window mosaic imagined, and nothing else.
 *
 * So this is a starting point rather than an output. It is written once, into
 * the application's own `bun/`, and never touched again — `desktop` copies it
 * and reads it, and would not know how to rewrite it.
 *
 * The only line that is not plainly about windows is `rpc:`, and it is inert in
 * an application with no services: `mosaic desktop` defines `mosaicRpc` before
 * this runs, and defines it as nothing when there is nothing to answer.
 */
export const MAIN_TEMPLATE = `// {{NAME}} — the native side, and what \`mosaic desktop\` runs as the main
// process. This directory is \`bun/\` by convention: the compiler skips it,
// because none of it is browser code and none of it belongs in the page bundle.
//
// It runs in Bun, not in the page. There is no DOM here — what it does is open
// the window the page is drawn in, and whatever else has to be asked of the
// operating system: menus, a tray, dialogs, the file system.
//
// This file is yours. It was written once by \`mosaic init desktop\` and is
// never regenerated; change the window, add more of them, do what you like.
//
// \`mosaic/desktop\` is Electrobun's own API with one thing already done: a
// window made from it can answer the page's calls to this application's
// services. Everything Electrobun exports is re-exported, so a tray or a menu
// is imported from here too — or from \`electrobun/bun\` directly, for a
// window deliberately wired to nothing.
//
// Two things are not free to change. The page lives at
// \`views://${VIEW}/index.html\` — that is the view \`desktop\` generates —
// and this file is \`${BUN_ENTRY}\`, which is the name Electrobun's launcher
// runs.
//
// Keep this directory self-contained. It is copied into the generated project
// whole, so a relative import reaching up out of it would not survive the move.
import { BrowserWindow } from "mosaic/desktop";

new BrowserWindow({
  title: {{TITLE}},
  url: "views://${VIEW}/index.html",
  frame: { width: 1024, height: 768, x: 200, y: 200 },
});
`;

/** What a build is made into, when the application says nothing about it. */
const DEFAULT_SHIPPING = {
  cef: false,
  codesign: false,
  notarize: false,
  dmg: false,
};

/** The page an application gets when it does not ship an `index.html`. */
const DEFAULT_PAGE = `<!doctype html>

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{TITLE}}</title>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
      #app { width: 100%; height: 100%; }
    </style>
  </head>

  <body>
    <div id="app"></div>
    <script type="module" src="app.js"></script>
  </body>
</html>
`;

/** A bundle identifier from an application's name, when it does not name one. */
function identifierFor(name) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app";
  return `com.mosaic.${slug}`;
}

/** How Electrobun should refer to `target` from the generated project. */
function from(dir, target) {
  return path.relative(dir, target).split(path.sep).join("/");
}

/**
 * The application's page, rewritten for the bundle it will sit in.
 *
 * A mosaic page loads `build/app.js`, because that is where the bundle is
 * relative to the application directory it is served from. Electrobun copies
 * the page and the bundle into one directory, so the path that was right for
 * the served app is wrong here and the reference has to move with it. The
 * application's own file is not touched: what is rewritten is this run's copy.
 */
function pageFor(source, outfileName, title) {
  if (!source) return DEFAULT_PAGE.split("{{TITLE}}").join(title);

  const html = fs.readFileSync(source, "utf8");
  // Only a reference to this application's own bundle is rewritten, wherever
  // it sits in the tree — `build/app.js`, `./build/app.js`, `../build/app.js`.
  return html.replace(
    /(["'])((?:\.{1,2}\/)*)[^"']*\/?app\.js\1/g,
    (match, quote) =>
      match.includes(outfileName) || match.endsWith(`/app.js${quote}`)
        ? `${quote}app.js${quote}`
        : match,
  );
}

/** The one Electrobun rpc method every mosaic call travels on. */
export const RPC_METHOD = "mosaic.rpc";

/** Where the copied dispatcher and the generated registry sit, inside `bun/`. */
const RPC_DIR = "_mosaic";

/** Where the generated view-side entry sits, beside the page it loads. */
const VIEW_DIR = "view";

/**
 * The page's way home, generated only for the desktop.
 *
 * This is the half a browser must never see. It imports `electrobun/view` — the
 * toolkit's published client — so it cannot be part of an application's own
 * bundle: that bundle is compiled once and served by `mosaic web` to browsers
 * where no such module exists. Generating it here and bundling it only into the
 * desktop build is what keeps one compiled application able to run in both
 * places.
 *
 * `Electroview` owns the socket, the encryption and the request/response
 * matching. What is left for this file is to say which method mosaic calls
 * travel on, and to hand the result to the page's rpc client.
 *
 * It is imported before the application, so the transport is in place by the
 * time a controller's `attached()` makes its first call.
 */
const VIEW_RPC = `// Generated by \`mosaic desktop\`. Written fresh on every run — edits are lost.
import { Electroview } from "electrobun/view";

// No handlers: the page asks and the main process answers, never the reverse.
//
// \`Infinity\` is the only value that disables the bridge's own timer — it is
// compared against by identity, and every other number, \`0\` included, is taken
// as a deadline in milliseconds. A call takes as long as the service takes, and
// how long a service may take is the service's business.
const rpc = Electroview.defineRPC({
  maxRequestTime: Infinity,
  handlers: { requests: {}, messages: {} },
});

// Binds \`rpc\` to the webview's socket. Nothing else is done with it: holding
// the instance is what keeps the connection alive.
new Electroview({ rpc });

// What \`mosaic/frameworks/rpc\` looks for. One method carries every call, with
// the name of what is really being called inside the message, so a service is
// reachable the moment it is written.
globalThis.mosaicRpcTransport = {
  kind: "desktop",
  send: (message) => rpc.request(${JSON.stringify(RPC_METHOD)}, message),
};
`;

/**
 * The desktop build's view entry: the way home, and then the application.
 *
 * Two static imports, in that order, so the transport is installed before any
 * application code runs.
 */
const VIEW_MAIN = `// Generated by \`mosaic desktop\`. Written fresh on every run — edits are lost.
//
// The name is the page's: Electrobun bundles a view under its entrypoint's
// name, and the page loads \`app.js\`.
import "./rpc.js";
import {{APP}};
`;

/**
 * `mosaic/desktop`: Electrobun's API, with the page's calls already wired up.
 *
 * An application's main process is its own, and what it wants from mosaic there
 * is one thing — that a window it makes can answer the page. Asking for that by
 * hand meant a line about rpc in a file that is otherwise about windows, naming
 * a thing defined nowhere the author could see. So it is done here instead, and
 * the author writes `new BrowserWindow({...})`.
 *
 * Everything Electrobun exports is re-exported unchanged; only `BrowserWindow`
 * differs, and only in what it defaults `rpc` to. Passing an `rpc` of your own
 * still wins, and importing from `electrobun/bun` still gets the plain class.
 */
const DESKTOP_MODULE = `// Generated by \`mosaic desktop\`. Written fresh on every run — edits are lost.
import { BrowserView, BrowserWindow as ElectrobunWindow } from "electrobun/bun";

import { dispatch } from "../../${RPC_DIR}/dispatch.js";
import services from "../../${RPC_DIR}/services.js";

/**
 * The bridge a window answers on.
 *
 * Every mosaic call travels on one Electrobun method: what is being called is
 * in the message, so a service is reached by exporting a function and nothing
 * has to be registered here.
 *
 * \`Infinity\` is the only value that disables the bridge's own timer — it is
 * compared against by identity, and every other number, \`0\` included, is
 * taken as a deadline in milliseconds. A call takes as long as the service
 * takes.
 */
const answering = (window = null) =>
  BrowserView.defineRPC({
    maxRequestTime: Infinity,
    handlers: {
      requests: {
        ${JSON.stringify(RPC_METHOD)}: (message) =>
          dispatch(message, services, { window, host: "desktop" }),
      },
      messages: {},
    },
  });

export * from "electrobun/bun";

/** Electrobun's window, answering this application's services by default. */
export class BrowserWindow extends ElectrobunWindow {
  constructor(options = {}) {
    super({ ...options, rpc: options.rpc ?? answering() });
  }
}
`;

/**
 * The same module for an application with no services.
 *
 * There is nothing to answer, so there is nothing to bind — but the import has
 * to resolve, because whether an application has services is not something its
 * main process should have to import differently for.
 */
const DESKTOP_MODULE_PLAIN = `// Generated by \`mosaic desktop\`. Written fresh on every run — edits are lost.
//
// This application has no services, so a window has nothing to answer and this
// is Electrobun's API exactly as it comes. Add a module to \`${BUN_DIR}/services/\`
// and the next build binds one.
export * from "electrobun/bun";
`;

/**
 * Write the Electrobun project for `app` and return where it went.
 *
 * @param app     the layout a command is running against: `sourceRoot`,
 *                `outdir`, `outfile`, and the `bunDir` convention.
 * @param config  the application's `info.json`, merged.
 * @param dir     where to write the project.
 * @param prod    whether this is a build to ship rather than one to run.
 *                It decides what Electrobun is asked for: minified bundles,
 *                and the application packed into an archive.
 */
export function writeProject({ app, config, dir, prod = false }) {
  // Only what this generates is cleared. `node_modules` and the lockfile beside
  // it are this project's too, and reinstalling them on every run would make
  // starting an app a minute's work instead of a moment's.
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [CONFIG, "index.html", BUN_DIR]) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }

  const title = config.app_name ?? app.name;
  const identifier = config.identifier || identifierFor(title);

  // The native side is copied in rather than pointed at, so that every module
  // the main process imports resolves against this project's `node_modules` —
  // the one holding what `dependencies` in the application's info.json asked
  // for. A `bun/` is self-contained for the same reason: it is copied whole,
  // and a relative import reaching up out of it would not survive the move.
  const bunDir = path.join(dir, BUN_DIR);
  const bunEntry = path.join(bunDir, BUN_ENTRY);

  // The application's `bun/` comes over whole — the main process, the services,
  // and whatever they are built out of.
  //
  // The main process has to be there. It is the application's own file and
  // there is nothing sensible to invent in its place: a generated window would
  // be one nobody asked for, and an app with no window is not a desktop app.
  if (!fs.existsSync(path.join(app.bunDir, BUN_ENTRY))) {
    throw new Error(
      `a desktop app needs a main process, and there is no ` +
        `${BUN_DIR}/${BUN_ENTRY} in ${app.sourceRoot}.\n` +
        "    Write one with `mosaic init desktop`.",
    );
  }
  fs.cpSync(app.bunDir, bunDir, { recursive: true });

  // The page, beside the bundle it loads, with its reference to that bundle
  // corrected for the directory Electrobun will put the two of them in.
  const ownPage = [
    path.join(app.sourceRoot, "index.html"),
    path.join(app.source, "index.html"),
  ].find((p) => fs.existsSync(p));
  const page = path.join(dir, "index.html");
  fs.writeFileSync(
    page,
    pageFor(ownPage, path.basename(app.outfile), title),
  );

  // The services, and the glue that answers a page's calls with them. Written
  // into the copy rather than into the application: it is derived from what
  // the application already says, and a generated file in a source tree is a
  // file someone will edit.
  //
  // Found in the copy rather than in the source tree, so the registry's
  // imports are its neighbours: this project is what Electrobun bundles, and
  // an import reaching back out of it would tie the packaged app to the
  // machine it was built on.
  const services = findServices(bunDir);
  if (services.length > 0) {
    const rpcDir = path.join(bunDir, RPC_DIR);
    fs.mkdirSync(rpcDir, { recursive: true });

    // The dispatcher is copied rather than imported: Electrobun bundles this
    // project from its bun entrypoint, and mosaic is not one of the project's
    // dependencies — nor should it be, since what is needed is one file.
    //
    // Found through `runtimeRoot`, the way every other tree mosaic ships is,
    // and not through this file's own directory: a compiled `mosaic` has no
    // directory to speak of, and the frameworks are installed beside the binary
    // rather than inside it.
    fs.copyFileSync(
      path.join(config.runtimeRoot, "..", "frameworks", "rpc", "dispatch.js"),
      path.join(rpcDir, "dispatch.js"),
    );
    fs.writeFileSync(
      path.join(rpcDir, "services.js"),
      registrySource(services, rpcDir),
    );
  }

  // The view side of the same wire. Generated only when there is something to
  // call: an application with no services has no reason to carry a bridge, and
  // its page is the bundle exactly as compiled.
  let viewEntry = app.outfile;
  if (services.length > 0) {
    const viewDir = path.join(dir, VIEW_DIR);
    fs.rmSync(viewDir, { recursive: true, force: true });
    fs.mkdirSync(viewDir, { recursive: true });

    fs.writeFileSync(path.join(viewDir, "rpc.js"), VIEW_RPC);
    // Named for what it will be bundled as, not for what it is: Electrobun
    // names a view's output after its entrypoint, and the page asks for
    // `app.js`. Calling this `index.js` would build a bundle the page never
    // loads — the bun side's failure, in the other half.
    viewEntry = path.join(viewDir, path.basename(app.outfile));
    fs.writeFileSync(
      viewEntry,
      VIEW_MAIN.replace(
        "{{APP}}",
        JSON.stringify(from(viewDir, app.outfile)),
      ),
    );
  }

  // Notarising without signing is not a thing Apple will do, and asking for it
  // would fail deep inside a build that had already taken a minute.
  const shipping = { ...DEFAULT_SHIPPING, ...(config.desktop ?? {}) };
  if (shipping.notarize && !shipping.codesign) {
    throw new Error(
      '"desktop.notarize" needs "desktop.codesign" — Apple will not notarise ' +
        "an unsigned build",
    );
  }

  // What `mosaic/desktop` is, for this application.
  //
  // A package inside the copied `bun/`, so the author's `index.js` resolves it
  // as an ordinary import — `bun/node_modules/mosaic` is the first place a
  // resolver looks from there — and so that what it imports in turn resolves
  // too: `electrobun/bun` is found by walking up out of it, the way anything
  // in this project finds it.
  //
  // It exists whether or not there are services. An application should not have
  // to import from somewhere else because it happens to have none, and the
  // module is the same either way — one of them binds an rpc and one does not.
  const pkg = path.join(bunDir, "node_modules", "mosaic");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    `${JSON.stringify(
      {
        name: "mosaic",
        version: config.version,
        private: true,
        type: "module",
        exports: { "./desktop": "./desktop.js" },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(pkg, "desktop.js"),
    services.length > 0 ? DESKTOP_MODULE : DESKTOP_MODULE_PLAIN,
  );

  const entry = bunEntry;

  const electrobun = {
    app: { name: title, identifier, version: config.version },
    build: {
      // Electrobun spreads everything beside `entrypoint` into its own
      // `Bun.build`, so `minify` is asked for the same way it would be of any
      // bundler. It has to be asked here as well as of the compiler: what the
      // compiler minifies is the application, and Electrobun bundles that
      // together with its own client into the file the page actually loads.
      views: { [VIEW]: { entrypoint: from(dir, viewEntry), minify: prod } },
      copy: { [from(dir, page)]: `views/${VIEW}/index.html` },
      bun: { entrypoint: from(dir, entry), minify: prod },
      // The application's code, packed into one archive rather than left as a
      // tree of files in `Resources/` — the same thing Electron's `app.asar`
      // is, and Electrobun reads it through the `libasar` it already ships.
      //
      // A `prod` build only: `dev` reloads by rewriting those files, and an
      // archive would have to be repacked for every keystroke.
      useAsar: prod,
      // What this build is made into, from "desktop" in the application's
      // config. Chromium applies to every run — an application that needs it
      // needs it while being written — and the rest only to a build that is
      // going somewhere, so a `dev` run is never slowed by signing something
      // nobody will install.
      mac: {
        bundleCEF: shipping.cef,
        createDmg: prod && shipping.dmg,
        codesign: prod && shipping.codesign,
        notarize: prod && shipping.notarize,
      },
      linux: { bundleCEF: shipping.cef },
      win: { bundleCEF: shipping.cef },
    },
  };

  fs.writeFileSync(
    path.join(dir, CONFIG),
    `// Generated by \`mosaic desktop\`. Written fresh on every run — edits here\n` +
      `// are lost. What it is generated from is the application's info.json.\n` +
      `export default ${JSON.stringify(electrobun, null, 2)};\n`,
  );

  // What the project installs: the application's own dependencies, and
  // Electrobun.
  //
  // Electrobun is not one of them and is not named in any info.json. It is what
  // `desktop` is *made of* — the same kind of thing as the runtime the compiler
  // vendors — and an application that says it is a desktop app has said
  // everything it needs to about that. Nobody should have to know the name of
  // the window toolkit, or keep its version current, to open a window.
  const declared = { ...(config.dependencies ?? {}) };
  const manifest = {
    name: identifierFor(title).split(".").pop(),
    version: config.version,
    private: true,
    dependencies: { ...declared, electrobun: ELECTROBUN_VERSION },
  };
  const manifestFile = path.join(dir, "package.json");
  const wanted = `${JSON.stringify(manifest, null, 2)}\n`;
  const had = fs.existsSync(manifestFile)
    ? fs.readFileSync(manifestFile, "utf8")
    : null;
  if (had !== wanted) fs.writeFileSync(manifestFile, wanted);

  return {
    dir,
    page,
    bunEntry: entry,
    /** The groups a page can call, for the command to report. */
    services: services.map(({ group }) => group),
    // What the application asked for, which is what there is any point telling
    // it about. Electrobun going in alongside is not news.
    dependencies: declared,
    // Whether an install is owed: the list changed, or there is nothing
    // installed to satisfy the one already written.
    needsInstall:
      had !== wanted || !fs.existsSync(path.join(dir, "node_modules")),
  };
}

/**
 * Install the project's dependencies, if it is owed an install.
 *
 * They land in the generated project rather than in the application, which is
 * what keeps an application's own directory to the things its author wrote:
 * `info.json` says what is needed, and the build directory is where the needing
 * is done. Deleting the build directory therefore costs an install and nothing
 * else.
 */
export async function installDependencies({
  dir,
  needsInstall,
  log,
  packages = [],
}) {
  if (!needsInstall) return true;

  const bun = Bun.which("bun");
  if (!bun) {
    throw new Error(
      "installing an app's dependencies is done with bun, and bun is not on " +
        "PATH.\n    Install it from https://bun.sh.",
    );
  }

  log?.("==> installing dependencies");
  // Named packages are handed straight to bun, which is what lets an
  // application declare its dependencies in info.json and keep no package.json
  // of its own: bun writes the one it needs. With none named this is the plain
  // install, against whatever package.json is already there.
  const proc = Bun.spawn([bun, "install", ...packages], {
    cwd: dir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`\`bun install\` failed in ${dir}`);
  }
  return true;
}

/**
 * Electrobun's CLI, as installed for this application.
 *
 * It is the application's dependency and not mosaic's: mosaic compiles the
 * page, and an application that wants to be a desktop app says so by depending
 * on the thing that makes it one. Looked for the way a module resolver would,
 * so it is found wherever in the project it was installed.
 */
export function findElectrobun(start) {
  let dir = path.resolve(start);
  for (;;) {
    const bin = path.join(dir, "node_modules", ".bin", "electrobun");
    if (fs.existsSync(bin)) return bin;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
