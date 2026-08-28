#!/usr/bin/env bun
// mosaic — the MosaicJS build tool.
//   mosaic init <name>                  create a new application
//   mosaic compile [dir]                compile the app and bundle it
//   mosaic web [dev] [dir]              the same, then serve it, rebuilding
//                                       and restarting on every change
//   mosaic compile watch [dir]          the same without the server: build, then
//                                       rebuild on every change
//   mosaic desktop [dev] [dir]          the same, run as a native desktop app
//   mosaic check [dir]                  the same, then run the browser test
//   mosaic clean [dir]                  delete the app's build directory
// An application is a directory with an `info.json` in it. That is the only
// thing a command takes — the current directory by default — and `main_file`
// in the config says which module is the bootstrap.
// The application's code is the tree `main_file` sits in — everything beside
// it and below it, and nothing above — so `info.json` can sit further up,
// at the root of a project whose other directories are none of the compiler's
// business. Everything the build produces lands in a `build/` inside the app
// directory. That makes the app directory the whole of the deployable thing —
// which is what `web` serves as its root, so a page can never reach up out of
// the app it belongs to.
// `info.json` is the configuration, merged from the project root down to the
// application. The bundle is Bun's: it walks the import graph from the
// bootstrap, so the payload holds only what the entry actually reaches — the
// runtime included, each module exactly once.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compileAll } from "../src/js/core/compiler/build.js";
import { componentName } from "../src/js/core/compiler/compile.js";
import { ensureTeaVM, compileShared } from "../src/js/core/compiler/teavm.js";
import { projectClasspath } from "../src/js/core/compiler/jvmdeps.js";
import { generateDocs } from "../src/js/core/compiler/doc.js";
import { scope as scopeCss } from "../src/js/core/compiler/css.js";
import { MESSAGES_ROOT } from "../src/js/core/compiler/js.js";
import { dispatch, methodsOf } from "../src/js/frameworks/rpc/dispatch.js";
import { findServices, registrySource } from "../src/js/frameworks/rpc/services.js";
import {
  BUN_DIR,
  BUN_ENTRY,
  DESKTOP_DIR,
  MAIN_TEMPLATE,
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
const MODE_COMMANDS = ["web", "desktop"];
/**
 * `compile watch`: build, and go on building. A word rather than a command of
 * its own, because it is the same command meant a different way — as `dev` is
 * to `web` — and what it produces is a compile and nothing else.
 */
const WATCH = "watch";

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
/** The bare specifier the compiled shared (TeaVM) code is imported by. */
const SHARED_SPECIFIER = "shared";
/** Where frameworks land inside the vendored runtime package, and their subpath. */
const FRAMEWORKS = "frameworks";
/** What `install` is told to install, when it is not the dependencies. */
const FRAMEWORK_SUBJECT = "framework";
const THEME_SUBJECT = "theme";
const SUBJECTS = [FRAMEWORK_SUBJECT, THEME_SUBJECT];
/** Where a framework keeps its themes, one stylesheet each. */
const THEMES = "themes";
/** The module a framework's themes are written into, beside its index. */
const THEME_MODULE = "theme.js";
/**
 * Where an application keeps its translations, one JSON file per locale, named
 * for it: `locales/fr.json`.
 *
 * A catalog is flat — `{"save": "Enregistrer"}` — mapping a key to its text in
 * that language. The key may be a short name whose default (usually English)
 * text is in `default.json`, or the English string itself with no default file
 * at all: a key the active locale and `default.json` both lack stays the key.
 */
const LOCALES = "locales";
/**
 * The catalog of default texts, keyed the same as every locale: what each key
 * says when the active locale does not translate it. Usually English, and not a
 * locale one can switch to — the fallback beneath all of them.
 */
const DEFAULT_LOCALE = "default";
/** The module an application's catalogs are written into, beside its bundle. */
const MESSAGES_MODULE = "messages.js";
/**
 * How a theme names its dark counterpart: `aristo` and `aristo_dark` are one
 * theme in two lights, and a build that carries the first carries the second
 * so the page can follow whichever the reader asked their system for.
 */
const DARK_SUFFIX = "_dark";
/** Where a framework keeps its icons, beside the themes that style them. */
const ICONS = `${THEMES}/icons`;
/**
 * Where `doc` writes, inside the build directory: `build/doc/`, opened at its
 * `index.html`.
 *
 * In the build because it is made rather than written, and everything mosaic
 * makes from an application lands there. It is not of the build, though — no
 * compile produces it and the bundle does not carry it — so a rebuild carries
 * it across rather than sweeping it away with the modules.
 */
const DOC_DIR = "doc";
/**
 * The two files `doc` generates for TypeDoc, in the build directory beside the
 * documentation.
 *
 * TypeDoc is configured by a `typedoc.json` and reads its types through a
 * `tsconfig.json`, and an application should not have to keep either: what it
 * has is a `"doc"` section in its ${CONFIG}, and these are written from it on
 * every run. They are generated files in the build, so nothing here is
 * something anyone will edit and find overwritten.
 */
const DOC_TSCONFIG = "tsconfig.doc.json";
const DOC_OPTIONS = "typedoc.doc.json";
/** The plugin `doc` generates beside them; see DOC_PLUGIN_SOURCE. */
const DOC_PLUGIN = "typedoc.names.js";
/** Where the stand-in framework indexes go; see writeFrameworkBarrels. */
const DOC_BARRELS = "typedoc.frameworks";
/** Where a documented framework is copied to be read; see placeFrameworks. */
const DOC_SOURCES = "frameworks";
/**
 * Block tags mosaic's sources use that TypeDoc does not know of itself.
 *
 * `@fires` is jsdoc's and is how a component says what it fires. TypeDoc
 * warns about a tag it has never heard of and drops the line, so every
 * component in the ui framework lost the one paragraph saying what it emits.
 */
const DOC_BLOCK_TAGS = ["@fires"];
/** The throwaway plugin that asks TypeDoc what it knows; see knownTags. */
const DOC_ASK = "typedoc.ask.js";
const DOC_ASK_MARKER = "mosaic-block-tags:";
const DOC_ASK_SOURCE = `// Generated by mosaic, run once and deleted: it prints
// the block tags and excluded tags this TypeDoc knows, so that \`@fires\` can be
// added to each rather than replacing them. Loaded with --help, so nothing is
// converted.
export function load(app) {
  console.log("${DOC_ASK_MARKER}" + JSON.stringify({
    blockTags: app.options.getValue("blockTags"),
    excludeTags: app.options.getValue("excludeTags"),
  }));
}
`;

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
  //
  // None by default: an application says which frameworks it is built against
  // and nothing is assumed for it. A `<Button/>` in markup resolves because
  // `ui` is listed, and an application that lists nothing cannot reach it —
  // there is no ambient set of components in scope.
  frameworks: [],
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
  // What a desktop build is made into.
  //
  // `cef` bundles Chromium rather than using the system webview, and applies to
  // every run: an application that needs it needs it while it is being written
  // too. The other three are about shipping, so `desktop prod` is the only
  // thing that reads them.
  //
  // No credentials here. Signing and notarising are done with an identity and
  // an Apple account, which are secrets and belong in the environment —
  // ELECTROBUN_DEVELOPER_ID, and ELECTROBUN_APPLEID with either
  // ELECTROBUN_APPLEIDPASS and ELECTROBUN_TEAMID or the ELECTROBUN_APPLEAPI*
  // key. An `info.json` is committed; those must not be.
  desktop: {
    /** Bundle Chromium instead of using the system webview. Hundreds of MB. */
    cef: false,
    /** Sign the build. Needs ELECTROBUN_DEVELOPER_ID. */
    codesign: false,
    /** Notarise it with Apple, which requires signing it first. */
    notarize: false,
    /** Also produce a disk image to hand it over in. */
    dmg: false,
  },
  // What `doc` makes of the application, as TypeDoc's own options — `name`,
  // `readme`, `excludePrivate`, anything it takes. Written into the config it
  // is handed, so an application says what it wants its documentation to look
  // like in the one file it already has, and keeps no `typedoc.json`.
  //
  // Two keys are read here rather than passed on, because they belong to the
  // TypeScript side of it and are how TypeDoc is told what the sources are:
  //
  //   compilerOptions   merged over the ones a JavaScript application needs,
  //                     which are already right and rarely worth touching
  //   include           what to document, as tsconfig patterns; the tree
  //                     `main_file` sits in by default
  //
  // Empty is the usual case: an application with no "doc" section is
  // documented from its JSDoc comments with nothing said.
  doc: {},
  // Both relative to the application directory, not the project root.
  main_file: `${SRC}/${ENTRY}`,
  outdir: "build",
  // Server-side JVM code compiled to JavaScript by TeaVM and folded into the
  // bundle: a directory, or an array of directories, of `.java`. Absent by
  // default — an application with no shared code names none. Classes it marks
  // `@JSExport` become importable by the Java package they are in, so a class in
  // `package units` is `import { Thing } from "units"`. No entry point to write:
  // mosaic generates one that keeps the exports. See compiler/teavm.js.
  shared: null,
  // The page `check` opens. Mosaic's own, unless an application names one.
  check: path.join(HOME, "test/browser-check.html"),
};

const USAGE = `usage: mosaic <command> [dir] [options]

commands:
  init <name>        create a new application in ./<name>
  init desktop       write the main process this app's window is opened by
  install            bun install: beside the app, or into the desktop project
                     when there is one
  install framework <name>
                     copy a framework into ./${FRAMEWORKS} and name it in ${CONFIG}
  install theme <name>
                     copy a theme's stylesheet into ./${THEMES}
  compile [watch]    compile the application and bundle it; \`watch\` keeps at it,
                     rebuilding on every edit — no server, no browser
  web [dev|prod]     compile, then serve it in a browser, rebuilding on every edit
  desktop [dev|prod] run it as a native desktop app, or build one
  check              compile, then run the headless browser test
  doc                document the application's sources from their JSDoc
  clean              delete the application's build directory

The argument is the application's directory — one with an ${CONFIG} in it —
and defaults to the current one. \`main_file\` in that config names the
bootstrap. For \`init\` the argument is the application's name instead, and
the directory to create.

A module in \`${BUN_DIR}/services/\` is an rpc service, and its file name is the
group a page calls it by: \`notes.js\` answers \`api.notes.*\`. \`web\` serves them
at \`/rpc\`; \`desktop\` answers the same calls over the window's own bridge.
The page reaches them with the rpc framework — \`install framework rpc\`.

\`web\` and \`desktop\` take a mode. \`dev\`, the default, keeps up with
the edits: everything from \`main_file\`'s directory down is watched — the
\`${BUN_DIR}/\` included — and every change rebuilds and runs it again.

\`desktop prod\` builds instead of running: an application bundle for this
machine's platform, left in the build directory, with the page's bundle
minified and the app packed into an archive. What else it is made into is
"desktop" in ${CONFIG} — \`codesign\`, \`notarize\`, \`dmg\`, and \`cef\`
to bundle Chromium rather than use the system webview. Signing reads its
identity from the environment, never from ${CONFIG}. \`web prod\` is not
implemented yet.

\`compile watch\` is \`web\` with the server taken out: it compiles, then watches
the same trees and rebuilds on every change, so a build stays current for
something else to serve, load or ship. The word is how the command is meant,
as \`dev\` is for \`web\`, so a directory of that name is \`./watch\`.

\`--outdir\` says where that build lands, overriding "outdir" in ${CONFIG} —
which is what lets the output go somewhere another tool is watching, rather
than the app's own \`build/\`.

\`doc\` documents the same tree \`compile\` walks — everything from
\`main_file\`'s directory down — from the JSDoc comments already in it, reading
the sources rather than a build so it needs none. It is also the one command
that does not need a bootstrap: a framework is a tree of components with no
\`main.js\` to point at, and \`mosaic doc\` on one documents the framework. It lands in
\`<build>/${DOC_DIR}/\`, which a rebuild carries across rather than sweeping
away, or wherever \`--outdir\` names.

Nothing is installed to do it: mosaic reads the sources itself. Visibility is
opt-in — a \`@public\` declaration is documented, a \`@protected\` one is too and
is marked as a subclass's, and anything unmarked is left out, as is a directory
named \`private\`. Each file is documented for what it is: a class, a module of
functions, or a Mosaic component, whose props its \`static properties\` declares.
Types come from the JSDoc: \`@param {string} name\` documents a string, and the
same line without the braces documents an \`any\`.

options:
  --outdir <path>    where the build lands, overriding "outdir" in ${CONFIG};
                     for \`doc\`, where the documentation lands and nothing else
  --port <n>         port for \`web\` (default 3000)
  --page <path>      page for \`check\`, relative to the current directory
  --title <text>     index heading for \`doc\` (default: the folder's name + " Documentation")
  --no-open          don't launch a browser
  --no-watch         don't rebuild when sources change
  --no-sourcemap     skip source maps
  --quiet            only report failures
  --keep-modules     leave the compiled modules the bundle was built from
  --minify           minify the bundle
  -h, --help         this text

\`desktop\` builds the desktop project itself, inside the build directory, on
every run, and installs into it: the app's own "dependencies" from ${CONFIG},
and the toolkit it runs on, which no app has to name. The main process is
generated too — the title and "window" in ${CONFIG} are all it takes. A
\`${BUN_DIR}/\` beside \`main_file\` holds the app's services and nothing else;
the compiler skips the directory.

"locales" in ${CONFIG} names the languages a build carries — \`["en", "fr"]\` —
and "locale" which of them it opens in, defaulting to the first. Each is a flat
\`${LOCALES}/<name>.json\` of key to translation. A key is a short name, not a
sentence: markup says \`{${MESSAGES_ROOT}.save}\`, and the message it stands for
goes in \`${LOCALES}/${DEFAULT_LOCALE}.json\` — the default (usually English) text.
A key resolves in the active language first, then \`${DEFAULT_LOCALE}.json\`, then
the key itself. \`setLocale\` swaps between the languages with nothing fetched.

Configuration is ${CONFIG}, merged from the project root down to the app.`;

/**
 * The short usage shown when a command is missing or wrong, or a run fails — the
 * one line that says the shape of a command, and where the rest of it is. The
 * full USAGE, with the command list and everything it explains, is for
 * \`--help\` alone; a screen of it under every error buries the mistake.
 */
const BRIEF = `usage: mosaic <command> [dir] [options]

Run \`mosaic --help\` for the commands and their options.`;

/**
 * One line per option, keyed by flag, so a command's help can name only the
 * options it takes. Kept together with the command table below and the full
 * USAGE so the three say the same thing.
 */
const OPTION_HELP = {
  "--outdir": `--outdir <path>    where output lands, overriding "outdir" in ${CONFIG}`,
  "--port": "--port <n>         port for the server (default 3000)",
  "--page": "--page <path>      page to load, relative to the current directory",
  "--title": '--title <text>     index heading (default: the folder\'s name + " Documentation")',
  "--no-open": "--no-open          don't launch a browser",
  "--no-watch": "--no-watch         don't rebuild when sources change",
  "--no-sourcemap": "--no-sourcemap     skip source maps",
  "--quiet": "--quiet            only report failures",
  "--keep-modules": "--keep-modules     leave the compiled modules the bundle was built from",
  "--minify": "--minify           minify the bundle",
};

/**
 * What each command is and which options reach it, so `mosaic <command> --help`
 * answers for that command alone rather than the whole tool.
 */
const COMMAND_HELP = {
  init: {
    usage: "mosaic init <name>  |  mosaic init desktop",
    blurb: "Create a new application in ./<name>, or write the desktop main process.",
    options: [],
  },
  install: {
    usage:
      "mosaic install  |  mosaic install framework <name>  |  mosaic install theme <name>",
    blurb: "bun install (beside the app, or into the desktop project), or copy a framework or theme in.",
    options: ["--quiet"],
  },
  compile: {
    usage: "mosaic compile [watch] [dir]",
    blurb: "Compile the application and bundle it. `watch` rebuilds on every edit.",
    options: ["--outdir", "--minify", "--keep-modules", "--no-sourcemap", "--no-watch", "--quiet"],
  },
  web: {
    usage: "mosaic web [dev|prod] [dir]",
    blurb: "Compile, then serve it in a browser, rebuilding on every edit.",
    options: ["--outdir", "--port", "--no-open", "--no-watch", "--no-sourcemap", "--quiet"],
  },
  desktop: {
    usage: "mosaic desktop [dev|prod] [dir]",
    blurb: "Run it as a native desktop app, or build one.",
    options: ["--outdir", "--no-watch", "--no-sourcemap", "--quiet"],
  },
  check: {
    usage: "mosaic check [dir]",
    blurb: "Compile, then run the headless browser test.",
    options: ["--outdir", "--page", "--no-open", "--keep-modules", "--no-sourcemap", "--quiet"],
  },
  doc: {
    usage: "mosaic doc [dir]",
    blurb:
      "Document the application's sources — every `.js` from `main_file`'s directory down, a `private/` folder skipped — into HTML, reading the JSDoc comments already in it. It needs no build and no bootstrap, so `mosaic doc` on a framework documents the framework. Output lands in `<build>/" +
      DOC_DIR +
      "/`, or wherever `--outdir` names.",
    options: ["--outdir", "--title", "--quiet"],
  },
  clean: {
    usage: "mosaic clean [dir]",
    blurb: "Delete the application's build directory.",
    options: [],
  },
};

/**
 * Help for one command — its synopsis, what it does, and only the options it
 * takes — or the full USAGE when the command is unknown or absent.
 */
function commandHelp(command) {
  const spec = COMMAND_HELP[command];
  if (!spec) return USAGE;

  const lines = [`usage: ${spec.usage}`, "", spec.blurb, "", "options:"];
  for (const flag of spec.options) lines.push(`  ${OPTION_HELP[flag]}`);
  lines.push("  -h, --help         this text");
  return lines.join("\n");
}

/**
 * There is no application here: no `info.json` in the directory a command was
 * given, or in any above it.
 *
 * A class of its own so the top level can say that and stop. Every other way a
 * command can be wrong is a matter of how it was written — an unknown option, a
 * missing name — and the usage text answers those. This one it cannot: the
 * command was written correctly and there is simply nothing here to run it
 * against, so a screen of usage buries the one line that matters.
 */
class NoApplication extends Error {}

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
    throw new NoApplication(`no ${CONFIG} in ${from} or any directory above it`);
  }

  const config = { ...DEFAULTS, root: chain[0].dir };
  for (const { dir, data } of chain) {
    for (const [key, value] of Object.entries(data)) {
      if (PATH_KEYS.includes(key)) config[key] = path.resolve(dir, value);
      else if (key === "shared") {
        // One directory or several: a string is the one, an array the several,
        // and either way it lands as a list of absolute directories — or null
        // when the list is empty, so downstream only ever asks "is there any?".
        const list = (Array.isArray(value) ? value : [value]).map((v) =>
          path.resolve(dir, v),
        );
        config.shared = list.length > 0 ? list : null;
      } else if (key === "frameworks") {
        // Each one, and whatever each is itself built on.
        config[key] = withFrameworkDependencies(
          value.map((entry) => resolveFramework(entry, dir)),
        );
      } else if (key === "libraries") {
        config[key] = value.map((entry) => ({
          ...entry,
          input: path.resolve(dir, entry.input),
        }));
      } else config[key] = value;
    }
  }
  return config;
}

/**
 * A framework named in `info.json`, found on disk.
 *
 * `"frameworks": ["ui"]` names one by name, and it is looked for in two
 * places, nearest first:
 *
 *   <dir>/frameworks/ui              the project's own, beside its info.json
 *   <mosaic>/src/js/frameworks/ui    the ones mosaic ships
 *
 * A project's own wins, so a framework can be forked into a repository and
 * built against without anything else changing. Either way it is compiled into
 * the build as `mosaic/frameworks/<name>`, which is what markup naming
 * `<Button/>` resolves through.
 *
 * `{name, input}` says where instead of asking for it to be found — for a
 * tree that sits somewhere neither rule reaches.
 *
 * Being listed is what makes a framework reachable. Nothing is in scope by
 * default, so a `<Button/>` in an application that names no framework is an
 * error at compile time rather than a component quietly arriving from
 * somewhere the application never mentioned.
 */
function resolveFramework(entry, dir) {
  if (typeof entry === "object" && entry !== null) {
    return { ...entry, input: path.resolve(dir, entry.input) };
  }

  const name = String(entry);
  const places = [
    path.resolve(dir, FRAMEWORKS, name),
    path.join(HOME, "src/js", FRAMEWORKS, name),
  ];
  const input = places.find((p) => fs.existsSync(p));
  if (!input) {
    throw new Error(
      `${CONFIG}: no framework named "${name}" — looked in ` +
        places.join(" and "),
    );
  }
  return { name, input,...frameworkInfo(input, name) };
}

/**
 * What a framework says about itself: the `info.json` in its own directory.
 *
 * A framework is a thing in its own right, and describes itself the way an
 * application does — its name, its version, who wrote it. It needs less: a
 * theme and the locales are the application's choice, and a framework that is
 * not built on another names no frameworks either.
 *
 * Absent is allowed. A tree of components with no `info.json` is still a
 * framework, and is the one the directory it was found in says it is.
 *
 * @param {string} input Where the framework is.
 * @param {string} name What it was asked for as.
 * @returns {object} `{version, author, frameworks}`, as far as it says.
 */
function frameworkInfo(input, name) {
  const file = path.join(input, CONFIG);
  if (!fs.existsSync(file)) return {};

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }

  // A framework is reached by name, and the name it answers to is the one the
  // directory holding it has. One that says it is something else has been
  // copied and not renamed — or renamed and not told — and is worth saying so
  // rather than compiling into a package under a name it disowns.
  const said = data.framework_name;
  if (said !== undefined && said !== name) {
    throw new Error(
      `${file}: this framework calls itself "${said}", but it was reached as ` +
        `"${name}" — a framework answers to the directory it is in`,
    );
  }

  return {
...(data.version !== undefined ? { version: data.version } : {}),
...(data.author !== undefined ? { author: data.author } : {}),
    // What it is built on, if anything. A framework of components drawn with
    // another framework's is as ordinary as an application built on one, and
    // says so the same way.
...(data.frameworks !== undefined ? { frameworks: data.frameworks } : {}),
  };
}

/**
 * The frameworks an application is built against, and the ones those are built
 * against, all the way down.
 *
 * A framework naming another in its own `info.json` is depended on by whatever
 * names it: an application that lists `charts` and nothing else still draws
 * with the `ui` that charts is made of, and every one of them has to be
 * compiled into the build for that to resolve.
 *
 * Depth first, so a framework is compiled after what it is built on, and named
 * once however many things name it — two frameworks sharing a dependency is
 * the ordinary case, not a conflict.
 */
function withFrameworkDependencies(frameworks) {
  const found = [];
  const seen = new Set();

  const walk = (framework, chain) => {
    const at = path.resolve(framework.input);
    if (seen.has(at)) return;
    // A cycle is a mistake rather than something to resolve forever.
    if (chain.includes(at)) {
      throw new Error(
        `${CONFIG}: frameworks are built on each other in a circle — ` +
          `${[...chain, at].map((p) => path.basename(p)).join(" -> ")}`,
      );
    }

    for (const entry of framework.frameworks ?? []) {
      // Two places, nearest first: a `frameworks/` the framework keeps of its
      // own, and the collection it is itself sitting in — one framework built
      // on another usually means two directories side by side. `mosaic`'s own
      // are the last resort either way, which `resolveFramework` covers.
      const beside = path.dirname(path.dirname(framework.input));
      let found;
      try {
        found = resolveFramework(entry, framework.input);
      } catch (e) {
        if (beside === framework.input) throw e;
        found = resolveFramework(entry, beside);
      }
      walk(found, [...chain, at]);
    }

    seen.add(at);
    // Its own `frameworks` was how it found what it is built on; it is not a
    // key of the framework as the rest of the build reads one.
    const { frameworks: _built_on,...rest } = framework;
    found.push(rest);
  };

  for (const framework of frameworks) walk(framework, []);
  return found;
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
          // What this application is built against. A framework is reachable
          // because it is named here: `<Button/>` in the markup resolves to
          // `mosaic/frameworks/ui` because "ui" is on this list, and an
          // application that names none has no components in scope.
          frameworks: ["ui"],
          main_file: `${SRC}/${ENTRY}`,
        },
        null,
        2,
      ) + "\n",

    [`${SRC}/main.ib.xml`]: `<!-- ${name} — the page.

     The markup itself has no logic and no JavaScript: everything dynamic is a
     binding to the controller, which is AppController.js beside this file.
     (Point at a different module with <interface owner='./SomeName'>.)

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

     One <style> block, anywhere inside <interface> — it is hoisted out of the
     markup and scoped to this file, so its selectors only ever match this
     page. Use :global(...) to opt one out. Convention is to put it last.

     Everything the file draws goes inside <interface>, which is the file
     itself rather than anything it draws. One root, so the file is XML an
     editor can check. Nothing renders until there is markup in it. -->

<interface>
</interface>
`,

    [`${SRC}/AppController.js`]: `// The controller behind main.ib.xml: the page's state, the values its {bindings}
// read, and the methods its actions fire.
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
// \`main.ib.xml\` is this module's page: it sits beside this file, so the compiler
// compiles it and registers it as the application's page — there is nothing to
// import and nothing to name. The runtime is vendored into the build as a
// package, so it is imported by name.
import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
`,

    [`${SRC}/${BUN_DIR}/services/greeting.js`]: `// ${name} — a service: something the page can call that runs outside it.
//
// This directory is \`${BUN_DIR}/services/\` by convention. The compiler skips
// \`${BUN_DIR}/\` entirely, because none of it is browser code and none of it
// belongs in the page's bundle.
// A service is a plain module. It knows nothing about rpc, nothing about the
// desktop, and nothing about how it is reached — which is what lets the same
// file answer over the desktop bridge under \`mosaic desktop\` and over HTTP
// under \`mosaic web\`. The file name is the group: this is \`greeting\`, so
// the page calls \`greeting.hello(...)\`.
// The default export is the group: every function on it is callable, arguments
// and return values make the trip as JSON, and an async function is awaited
// before its answer is sent.
// The window itself is not written here or anywhere in the application:
// \`mosaic desktop\` generates the main process, and what it needs to know —
// the title, the size of the window — is in info.json.
export default {
  hello(who = "world") {
    return \`Hello, \${who}.\`;
  },
};
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
  console.log(`    cd ${name} && mosaic web`);
  return 0;
}

/**
 * Write the main process an application opens its window with.
 *
 * The one file `desktop` needs and does not generate. It is written into the
 * application's own `bun/`, once: run again, it says the file is there and
 * leaves it alone, because by then it is not this template any more — it is
 * whatever the author made of it.
 *
 * Order does not matter. Run before anything has been built, and `desktop` will
 * find it; run after, and the next build picks it up. What is never touched is
 * the generated project, which is rewritten from the application every time
 * anyway.
 */
function initDesktop() {
  const source = resolveApp(null);
  const config = loadConfig(source);
  const app = layout(config, source);

  const file = path.join(app.bunDir, BUN_ENTRY);
  const say = path.relative(source, file);

  if (fs.existsSync(file)) {
    console.log(`${say} is already there — left as it is`);
    return 0;
  }

  const name = config.app_name ?? app.name;
  fs.mkdirSync(app.bunDir, { recursive: true });
  fs.writeFileSync(
    file,
    MAIN_TEMPLATE.split("{{NAME}}")
      .join(name)
      .split("{{TITLE}}")
      .join(JSON.stringify(name)),
  );

  console.log(`created ${say}`);
  console.log("");
  console.log("    it is yours now — the window, and anything else native");
  console.log("    mosaic desktop");
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
    throw new NoApplication(`no ${CONFIG} in ${dir}`);
  }
  return dir;
}

function parseArgs(argv) {
  const args = {
    command: null,
    entry: null,
    // Where the build lands, when it is not what `info.json` says. Resolved
    // against the directory the command was run from, which is the one the
    // person typing it is standing in — the run moves to the project root
    // before anything is built.
    outdir: null,
    port: 3000,
    page: null,
    open: true,
    watch: true,
    // Whether `compile` was told to keep going: `mosaic compile watch`.
    keepWatching: false,
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
    } else if (a === "--outdir") {
      args.outdir = argv[++i];
      if (!args.outdir) throw new Error("`--outdir` needs a path");
      args.outdir = path.resolve(args.outdir);
    } else if (a === "--page") {
      args.page = argv[++i];
      if (!args.page) throw new Error("`--page` needs a path");
    } else if (a === "--title") {
      args.title = argv[++i];
      if (!args.title) throw new Error("`--title` needs a value");
    } else if (a === "--no-open") args.open = false;
    else if (a === "--no-watch") args.watch = false;
    else if (a === "--no-sourcemap") args.sourcemap = false;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--keep-modules") args.keepModules = true;
    else if (a === "--minify") args.minify = true;
    else if (a === "-h" || a === "--help") {
      // A command already named narrows the help to that command; `--help`
      // on its own is the whole tool.
      console.log(commandHelp(args.command));
      process.exit(0);
    } else if (a.startsWith("-")) throw new Error(`unknown option \`${a}\``);
    else if (!args.command) args.command = a;
    // `install framework <name>`, `install theme <name>` — what is being
    // installed, then which one. Said as two words because `install` on its
    // own already means something else, and a bare name would have to guess
    // which.
    else if (args.command === "install" && SUBJECTS.includes(a) && !args.subject)
      args.subject = a;
    else if (args.subject && !args.name) args.name = a;
    // `dev` and `prod` say how a run is meant rather than where it is. A
    // directory of either name is still reachable as `./dev`.
    else if (MODES.includes(a) && !args.mode) args.mode = a;
    // `compile watch`, which is the same word on the same footing: it says
    // how the command is meant — once, or again on every edit — rather than
    // where. A directory called `watch` is still reachable as `./watch`.
    else if (a === WATCH && args.command === "compile" && !args.keepWatching)
      args.keepWatching = true;
    // Said to anything else, it is the word and not a directory — every other
    // command either watches already or has nothing to watch for. Taken as a
    // path it became "no such directory: …/watch", which reads as a mistake
    // about where the application is rather than about what was asked for.
    else if (a === WATCH && args.command !== "compile" && !args.entry)
      throw new Error(
        `\`${args.command}\` takes no \`${WATCH}\` — that is for \`compile\``,
      );
    else if (!args.entry) args.entry = a;
    else throw new Error(`unexpected argument \`${a}\``);
  }

  if (!args.command) throw new Error("missing command");
  if (
    ![
      "init",
      "install",
      "compile",
      "web",
      "desktop",
      "check",
      "clean",
      "doc",
    ].includes(args.command)
  ) {
    throw new Error(`unknown command \`${args.command}\``);
  }
  if (args.command === "init" && !args.entry)
    throw new Error("`init` needs a name, or `desktop`");
  if (args.subject && !args.name)
    throw new Error(`\`install ${args.subject}\` needs a name`);

  // `compile watch --no-watch` asks for both at once. Said rather than quietly
  // building once and exiting from something that was told to keep going —
  // building once is `mosaic compile`, with the word left off.
  if (args.keepWatching && !args.watch) {
    throw new Error("`compile watch --no-watch` is `mosaic compile`");
  }

  // Only the two commands that run an application have anything to say about
  // how. Silently accepting `mosaic compile prod` would be promising something.
  if (args.mode && !MODE_COMMANDS.includes(args.command)) {
    throw new Error(
      `\`${args.command}\` takes no mode — that is for ` +
        `${MODE_COMMANDS.map((c) => `\`${c}\``).join(" and ")}`,
    );
  }
  if (MODE_COMMANDS.includes(args.command)) args.mode ??= "dev";

  // A `prod` build is the one that ships, and nobody reads the bundle in it.
  // `--minify` stays an option for the other modes, where a readable build is
  // worth more than a smaller one.
  if (args.mode === "prod") args.minify = true;
  // `desktop prod` builds the thing you ship. `web prod` does not exist yet,
  // and saying so is better than quietly serving a dev build and calling it
  // production.
  if (args.mode === "prod" && args.command !== "desktop") {
    throw new Error(
      `\`${args.command} prod\` is not implemented yet — only \`${args.command} dev\``,
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
/**
 * A path as it is worth reading: relative to the project when it is inside it,
 * and said outright when it is not. A `--outdir` somewhere else entirely is
 * named by a climb of `../` otherwise, which is longer than the path it stands
 * for and says less.
 */
function within(root, target) {
  const relative = path.relative(root, target);
  if (relative === "") return ".";
  return relative.startsWith("..") ? target : relative;
}

function layout(config, source, options = {}) {
  // Relative to the application, as `info.json` states it — unless `--outdir`
  // named a place outright, in which case that is where the build goes and
  // resolving leaves it alone.
  const outdir = path.resolve(source, config.outdir);
  const main = path.join(source, config.main_file);
  const bootstrapped = fs.existsSync(main);

  // A bootstrap is what a build is built *from*, so every command that builds
  // needs one. `doc` does not build: it reads the sources, and a framework is
  // a tree of components with nothing to boot — no `main.js`, and an
  // `info.json` that says so by leaving `main_file` out. Documenting one is
  // ordinary, so a missing bootstrap is only an error for the commands that
  // cannot do without it.
  if (!bootstrapped && !options.mayLackMain) {
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
  //
  // With no bootstrap to sit in a tree, the tree is said the other way round:
  // a `src/` if there is one, and otherwise the directory itself, which is how
  // a framework is laid out — its components are in it rather than under it.
  const sourceRoot = bootstrapped
    ? path.dirname(main)
    : fs.existsSync(path.join(source, SRC))
      ? path.join(source, SRC)
      : source;

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
    // Nothing to bundle without a bootstrap, so there is nothing for the
    // bundle to be built from either. `doc` reads neither.
    entry: bootstrapped
      ? path.join(outdir, path.relative(sourceRoot, main))
      : null,
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
 * did not it was expensive: `web` watches the application directory and the
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

  // What sits in the build directory without being of the build is carried
  // across: the generated desktop project, which holds the dependencies
  // `desktop` installed — a compile that threw them away would charge every
  // rebuild an install for a page that changed — and the documentation
  // `doc` wrote, which is made from the sources rather than by compiling
  // them and would otherwise last exactly until the next keystroke.
  for (const kept of [DESKTOP_DIR, DOC_DIR]) {
    const carried = path.join(previous, kept);
    if (fs.existsSync(carried) && !fs.existsSync(path.join(target, kept))) {
      fs.renameSync(carried, path.join(target, kept));
    }
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
 * Vendoring is also what lets `web` serve the app as its root: a module
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
    // Where a theme for this framework may be found, nearest first: the
    // application's own `themes/`, then the ones the framework ships. A
    // project can add a theme without touching the framework, and a theme it
    // keeps under its own name wins over one of that name inside — the same
    // rule a framework itself follows.
    themes: [path.join(app.source, THEMES), path.join(framework.input, THEMES)],
  }));
}

/** The themes a framework offers: every stylesheet in the places it looks. */
function themeNames(framework) {
  const names = new Set();
  for (const dir of framework.themes) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (path.extname(file) === ".css") names.add(path.basename(file, ".css"));
    }
  }
  return [...names].sort();
}

/**
 * The stylesheet a theme name resolves to. Nearest first, so the application's
 * own copy is what a build wears when both have one.
 */
function themeFile(framework, name) {
  for (const dir of framework.themes) {
    const file = path.join(dir, `${name}.css`);
    if (fs.existsSync(file)) return file;
  }
  return null;
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
    scopeCss(fs.readFileSync(themeFile(framework, name), "utf8"), "", ":root", {
      minify: options.minify,
    }).trimEnd(),
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
/**
 * Compile the shared JVM tree with TeaVM and vendor it, so the bundle reaches it
 * the way it reaches `mosaic` — but by the Java package the code declares rather
 * than one catch-all name. A class in package `units` is imported from `"units"`;
 * one in `geo.shapes`, from `"geo/shapes"`. The package the code is organised
 * into is the package a page imports, and nothing has to be renamed in between.
 *
 * The jars are fetched on first use and cached; a JDK does the rest. TeaVM writes
 * one module holding every `@JSExport` class; this vendors a small package per
 * Java package that re-exports that package's classes from it.
 *
 * @returns {{ entry: string, classes: number, specifiers: string[] }}
 */
async function buildShared(config, app, args, log) {
  const dirs = config.shared;
  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`${CONFIG}: "shared" names ${dir}, which is not a directory`);
    }
  }

  const classpath = await ensureTeaVM(log);
  // The dependencies the shared code imports, resolved from the JVM project each
  // tree sits in — its build already pins the versions and the transitive
  // closure. Unioned across the trees, since two may share one project.
  const libs = [...new Set(dirs.flatMap((dir) => projectClasspath(dir, log)))];
  log("==> compiling shared");

  const nodeModules = path.join(app.outdir, "node_modules");
  // TeaVM's own output, kept out of the way under a dotted name: it is not what
  // a page imports — the per-package packages beside it re-export from it.
  const teavmDir = path.join(nodeModules, ".mosaic-shared");
  fs.mkdirSync(teavmDir, { recursive: true });
  const moduleFile = path.join(teavmDir, "shared.js");

  const result = compileShared({
    sharedDirs: dirs,
    outFile: moduleFile,
    classpath,
    libs,
    sourcemap: args.sourcemap,
    log,
  });

  const specifiers = vendorSharedPackages(
    config,
    nodeModules,
    moduleFile,
    result.packages,
  );
  linkShared(app, specifiers);
  return { entry: result.entry, classes: result.classes, specifiers };
}

/**
 * Write, for each Java package, a package the bundler resolves by the package's
 * own name — `units`, or `geo/shapes` for a dotted one — that re-exports that
 * package's classes from TeaVM's single module.
 *
 * A dotted package becomes a subpath: `geo.shapes` is the `geo` package's
 * `./shapes`, so `geo` and `geo.solids` share one `geo` and never collide.
 *
 * @returns {string[]} the specifiers a page may import, one per package.
 */
function vendorSharedPackages(config, nodeModules, moduleFile, packages) {
  // Accumulated across packages that share a first segment: `geo.shapes` and
  // `geo.solids` both write into `geo`, whose exports gather both subpaths.
  const roots = new Map();
  const specifiers = [];

  for (const [pkg, classes] of Object.entries(packages)) {
    if (classes.length === 0) continue;
    // The default package has no name to import by; fall back to the catch-all.
    const segments = pkg === "" ? [SHARED_SPECIFIER] : pkg.split(".");
    const top = segments[0];
    const sub = segments.slice(1).join("/");
    const rootDir = path.join(nodeModules, top);

    if (!roots.has(top)) roots.set(top, { dir: rootDir, exports: {} });
    const root = roots.get(top);

    // The re-export module: `index.js` for the package itself, `<sub>.js` for a
    // subpath. It re-exports this package's classes from TeaVM's module.
    const relFile = sub ? `${sub}.js` : "index.js";
    const file = path.join(rootDir, relFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const toModule = relSpecifier(path.dirname(file), moduleFile);
    fs.writeFileSync(
      file,
      `// The ${pkg || "default"} package's shared classes, re-exported from the\n` +
        `// module TeaVM compiled. Written by mosaic; import from "${[top, sub].filter(Boolean).join("/")}".\n` +
        `export { ${classes.join(", ")} } from ${JSON.stringify(toModule)};\n`,
    );

    root.exports[sub ? `./${sub}` : "."] = `./${relFile}`;
    specifiers.push([top, sub].filter(Boolean).join("/"));
  }

  for (const [name, root] of roots) {
    fs.writeFileSync(
      path.join(root.dir, "package.json"),
      JSON.stringify(
        {
          name,
          version: config.version,
          type: "module",
          exports: root.exports,
          // The re-exports pull in TeaVM's module, which sets up its runtime as
          // it loads — a side effect the bundler must not drop before the page
          // has said what it wants.
          sideEffects: true,
        },
        null,
        2,
      ),
    );
  }
  return specifiers;
}

/** A relative import specifier from `dir` to `file`, `./`-prefixed and POSIX. */
function relSpecifier(dir, file) {
  let rel = path.relative(dir, file).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/**
 * Make the bootstrap import each shared package, so the code is in the bundle
 * whether or not a page has reached for an export yet. Named imports a page
 * writes work regardless; this only guarantees the code is carried.
 */
function linkShared(app, specifiers) {
  if (specifiers.length === 0) return;
  const imports = specifiers
    .map((s) => `import ${JSON.stringify(s)};`)
    .join("\n");
  const source = fs.readFileSync(app.entry, "utf8");
  fs.writeFileSync(
    app.entry,
    `${source.trimEnd()}\n\n// The shared code ${CONFIG} named, compiled by TeaVM and linked in by\n` +
      `// mosaic. Import a class by its Java package, e.g. \`import { Units } from "units"\`.\n${imports}\n`,
  );
}

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
 * Write the application's messages: the catalogs `info.json` named, as a module
 * that installs them.
 *
 *   "locales": ["en", "fr"],
 *   "locale": "fr"
 *
 * Each name is a file in `locales/` beside the application — `locales/fr.json`
 * — a flat object of key to translation, where a key is a short name. The text
 * each key stands for is in `locales/default.json` (usually English), so a
 * locale with no file of its own is one in which every key falls back to that
 * default — which is why `en.json` is usually absent when default.json is it.
 *
 * `locale` says which to start in, and defaults to the first named. It is the
 * same arrangement as `theme`, and for the same reason: what a build carries is
 * a list, what it opens in is one of them, and `setLocale` moves between them
 * without anything being fetched.
 *
 * @returns {object|null} `{module, names, locale}`, or null for an application
 *   that names no locales.
 */
function writeMessages(config, app, runtime, frameworks = []) {
  const names = config.locales ?? [];
  if (!Array.isArray(names)) {
    throw new Error(`${CONFIG}: "locales" must be a list of language names`);
  }

  // A framework's own strings first, the application's last.
  //
  // A framework says things of its own — a Drawer's close button, a
  // SearchField's placeholder — and they are as much part of it as its
  // stylesheet is. They are read first so that an application naming the same
  // key wins: what a component calls "close" in an application that words it
  // differently is the application's business, and overriding a framework
  // string should not mean forking the framework.
  const sources = [
    ...frameworks.map((framework) => path.join(framework.input, LOCALES)),
    path.join(app.source, LOCALES),
  ];

  // Merge every `<name>.json` found across the sources into one catalog for
  // that name. Absent is allowed everywhere: a locale with no file is one in
  // which every key falls back to its default, and a build with no `default.json`
  // is one in which every key falls back to itself.
  const gather = (name) => {
    const catalog = {};
    let found = false;
    for (const dir of sources) {
      const file = path.join(dir, `${name}.json`);
      if (!fs.existsSync(file)) continue;
      found = true;
      try {
        Object.assign(catalog, JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (e) {
        throw new Error(`${file}: ${e.message}`);
      }
    }
    return { catalog, found };
  };

  // The default texts — `default.json` — sit beneath every locale rather than
  // being one of them, so they are gathered on their own and never appear in
  // the switchable list.
  const defaults = gather(DEFAULT_LOCALE).catalog;

  const catalogs = {};
  for (const name of names) {
    if (name === DEFAULT_LOCALE) {
      throw new Error(
        `${CONFIG}: "${DEFAULT_LOCALE}" is the fallback catalog, not a locale ` +
          `to switch to — list the real languages in "locales" and put their ` +
          `defaults in ${LOCALES}/${DEFAULT_LOCALE}.json`,
      );
    }
    catalogs[name] = gather(name).catalog;
  }

  // Nothing to install: no languages named and no defaults to fall back to.
  if (names.length === 0 && Object.keys(defaults).length === 0) return null;

  // Which language to open in. `locale` names it, defaulting to the first
  // listed; an application with only a `default.json` and no `locales` opens in
  // the defaults themselves.
  const chosen = config.locale ?? names[0] ?? DEFAULT_LOCALE;
  if (names.length > 0 && !names.includes(chosen)) {
    throw new Error(
      `${CONFIG}: "locale" is "${chosen}", which is not one of the ` +
        `"locales" this build carries — ${names.join(", ")}`,
    );
  }

  const module = path.join(app.outdir, MESSAGES_MODULE);
  fs.writeFileSync(
    module,
    `// Generated by mosaic from ${CONFIG}. Written fresh on every build —\n` +
      `// edits here are lost; the catalogs are in ${LOCALES}/.\n` +
      `//\n` +
      `// The application's strings, in every language this build carries, over\n` +
      `// the default texts in ${LOCALES}/${DEFAULT_LOCALE}.json. They are in the\n` +
      `// bundle rather than fetched: a page that has to ask for its own words\n` +
      `// draws once in the wrong language and again in the right one.\n` +
      `import { MESSAGES } from ${JSON.stringify(runtime)};\n\n` +
      `MESSAGES.install(\n` +
      `  ${JSON.stringify(catalogs, null, 2).split("\n").join("\n  ")},\n` +
      `  ${JSON.stringify(chosen)},\n` +
      `  ${JSON.stringify(defaults, null, 2).split("\n").join("\n  ")},\n` +
      `);\n`,
  );

  return { module, names, locale: chosen };
}

/**
 * Make the application's bootstrap import its messages, as `linkThemes` does
 * for the theme: the catalogs belong to the application, and no module of it
 * names them.
 *
 * Imports are evaluated before the module that declares them runs, so the
 * catalogs are installed before the first line of application code — and well
 * before anything draws.
 */
function linkMessages(app, messages) {
  if (!messages) return;

  const specifier =
    "./" +
    path
      .relative(path.dirname(app.entry), messages.module)
      .split(path.sep)
      .join("/");

  const source = fs.readFileSync(app.entry, "utf8");
  fs.writeFileSync(
    app.entry,
    `// The locales ${CONFIG} named, linked in by mosaic: the catalogs are the\n` +
      `// application's, and nothing imports them by hand.\n` +
      `import ${JSON.stringify(specifier)};\n\n${source.trimStart()}`,
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
  // Stacks are for chasing a bug in mosaic, not for a mistake in the project
  // being built, so they are kept for `MOSAIC_DEBUG` and out of the way
  // otherwise. A wrapped error often repeats what its wrapper already said —
  // `compileAll` prefixes the file, the inner error is the rest — so a cause
  // whose message is already contained in one printed is not said twice.
  const debug = !!process.env.MOSAIC_DEBUG;
  const said = [];
  const say = (label, err) => {
    const message = err?.message ?? String(err);
    if (said.some((m) => m.includes(message) || message.includes(m))) return;
    said.push(message);
    console.error(`${label}${message}`);
    if (debug && err?.stack) console.error(err.stack);
  };
  say("mosaic: ", e);
  for (let cause = e?.cause; cause; cause = cause.cause) say("caused by: ", cause);
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
  const relative = (p) => within(config.root, settled(p));

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

  // Images are emitted beside the bundle and pointed at by a URL, rather than
  // inlined as data URLs that swell the payload by a third. The exception is
  // `check`, whose page loads the compiled modules unbundled: there is no one
  // bundle for `import.meta.url` to be relative to, so a null `assetDir` leaves
  // those images inlined and reachable. `assets` collects what was written, so
  // pruning the intermediate modules leaves the images standing.
  const assets = new Set();
  const assetDir = args.command === "check" ? null : path.dirname(app.outfile);

  log(`==> compiling ${relative(app.sourceRoot)}`);
  const written = compileAll(sources, {
    assetDir,
    assets,
    // Not source. The build this run will end up as — it is not written to
    // during the run, the staging directory is, so it has to be named or the
    // build sitting there from last time is walked as source — and the `bun/`
    // holding the native side, which is a program of its own and is compiled
    // by nothing here.
    skip: [
...(app.finalOutdir ? [app.finalOutdir] : []),
      app.bunDir,
      // The shared Java trees, which TeaVM compiles — the JS walker has no
      // business in them, whether they sit under the sources or off to the side.
...(config.shared ?? []),
      // And a build directory inside a framework, which is output rather than
      // source however it got there. `mosaic doc` run on a framework writes
      // its working files into one, and without this the next application to
      // name that framework compiled them into itself — a generated TypeDoc
      // plugin, shipped in a page's bundle.
...config.frameworks.map((framework) =>
        path.join(framework.input, DEFAULTS.outdir),
      ),
    ],
    runtime: vendored.specifier,
    // Where `import X from "svg:name"` looks: the application's own icons
    // first, so an app can replace one the framework ships.
    icons: iconDirs(config, app),
    sourcemap: args.sourcemap,
    // A stylesheet rides into the bundle as a string, where the bundler's own
    // minifier cannot see its comments. The compiler drops them instead.
    minify: args.minify,
  });

  // Each framework's index is written from what actually compiled into it, so
  // adding a component to the tree is all it takes to export one.
  const themes = [];
  // What the run is summarised with at the end: one line per framework, so the
  // reader sees what was built without reading it happen.
  const frameworkStats = [];
  for (const framework of frameworks) {
    const modules = written.filter((dest) =>
      path.resolve(dest).startsWith(path.resolve(framework.outdir) + path.sep),
    );
    const theme = writeFrameworkTheme(config, framework, {
      minify: args.minify,
    });
    writeFrameworkIndex(framework, modules, theme);
    const themed = theme
      ? `, ${theme.name} theme` +
        (theme.bundled.length > 1
          ? ` (+${theme.bundled.length - 1} to switch to)`
          : "")
      : "";
    frameworkStats.push(
      `    ${framework.specifier}  ${modules.length} modules${themed}`,
    );
    if (theme && usesFramework(framework, written, modules)) {
      themes.push(`${framework.specifier}/${THEME_MODULE}`);
    }
  }

  linkThemes(app, themes);

  // The application's own strings, in every language it carries.
  const messages = writeMessages(config, app, vendored.specifier, frameworks);
  linkMessages(app, messages);

  // Server-side JVM code, compiled to JavaScript by TeaVM and vendored as a
  // package the bundle pulls in. Only when `info.json` names a `shared` tree.
  if (config.shared) {
    const shared = await buildShared(config, app, args, log);
    const named = shared.specifiers.map((s) => `"${s}"`).join(", ");
    frameworkStats.push(
      `    shared  TeaVM ${shared.classes} methods${named ? `, imported from ${named}` : ""}`,
    );
  }
  if (messages) {
    const others = messages.names.filter((n) => n !== messages.locale);
    frameworkStats.push(
      `    ${LOCALES}  ${messages.locale}` +
        (others.length > 0 ? ` (+${others.join(", ")} to switch to)` : ""),
    );
  }

  log("==> bundling");
  // `throw: false`: a thrown build carries only "Bundle failed", and the
  // messages that say which import went unresolved are what is worth seeing.
  const result = await Bun.build({
    entrypoints: [app.entry],
    sourcemap: args.sourcemap ? "linked" : "none",
    target: "browser",
    // What is served is the bundle, so this is the one place minifying
    // belongs: the compiled modules stay readable, and a source map still
    // leads back to the `.ib.xml` a name came from.
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

  let removed = 0;
  if (!(args.keepModules || args.command === "check")) {
    removed = pruneModules(app, assets);
  }

  // The whole run in one place: what compiled, what it bundled to, and what was
  // cleaned up after. The files themselves are not worth naming one by one.
  log("==> compiled");
  log(`    ${written.length} modules from ${relative(app.sourceRoot)}`);
  for (const line of frameworkStats) log(line);
  log(
    `    ${relative(app.outfile)}  ${(bytes / 1024).toFixed(1)} KB${args.minify ? ", minified" : ""}`,
  );
  if (assets.size > 0) {
    const assetBytes = [...assets].reduce(
      (sum, file) => sum + fs.statSync(file).size,
      0,
    );
    log(
      `    ${assets.size} image${assets.size === 1 ? "" : "s"} beside it  ${(assetBytes / 1024).toFixed(1)} KB`,
    );
  }
  if (removed > 0) log(`    ${removed} intermediate modules removed`);
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
 * copy of the application beside the one being served — and, in `web`, one a
 * page could reach behind the bundle's back.
 *
 * The map is unaffected: Bun writes the sources into it, so the bundle stays
 * debuggable with nothing beside it.
 */
function pruneModules(app, assets = null) {
  const keep = new Set(
    [app.outfile, `${app.outfile}.map`].map((p) => path.resolve(p)),
  );
  // The images emitted beside the bundle are not intermediate — the page loads
  // them at run time — so they are kept while the modules are swept away.
  if (assets) for (const asset of assets) keep.add(path.resolve(asset));

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
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  // Images the compiler emits beside the bundle, so `web` serves them as what
  // they are rather than a generic download.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Serve `root` as static files; a directory serves its index.html. */
/** Where a checked page posts its verdict back to. */
const RESULT_PATH = "/__mosaic-check";

/**
 * Where a page's rpc calls land. One endpoint for every service: what is being
 * called is in the message, not in the path, so a service is reached by
 * exporting a function and nothing else has to be registered anywhere.
 */
const RPC_PATH = "/rpc";

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

/**
 * The application's services, ready to be called.
 *
 * The registry is written into the build and imported from there rather than
 * the source directory being read module by module: that generated file is
 * what the desktop's Bun side is bundled from, so loading the same one here is
 * what makes the two hosts run the same code. A service that is missing from
 * one is missing from both, and it fails at build time in both.
 *
 * @returns {Promise<{services: object, methods: string[]}|null>} null for an
 *   application with no services, which is most of them.
 */
async function loadServices(app) {
  const found = findServices(app.bunDir);
  if (found.length === 0) return null;

  const dir = path.join(app.outdir, "rpc");
  const registry = path.join(dir, "services.js");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registry, registrySource(found, dir));

  // Fresh every run: a dev server restarted after a service was edited must
  // not answer from the module it imported an hour ago. Bun caches by
  // specifier, so the query is what makes this a different one.
  const loaded = await import(`${pathToFileURL(registry).href}?t=${Bun.nanoseconds()}`);
  const services = loaded.default ?? {};

  return { services, methods: methodsOf(services) };
}

/** The port `web` was asked for is being listened on by something else. */
class PortInUse extends Error {
  constructor(port) {
    super(`port ${port} is already in use`);
    this.port = port;
  }
}

/**
 * What is listening on `port`, as near as can be told: `"node (pid 4821)"`, or
 * null when it cannot be told at all.
 *
 * Best effort, and never worth failing over: `lsof` is not on every machine,
 * and a port held by another user's process will not name itself to this one.
 * Knowing that the thing in the way is another mosaic is most of the answer,
 * though, so it is worth asking.
 */
function whatHasPort(port) {
  const lsof = Bun.which("lsof");
  if (!lsof) return null;

  try {
    const found = Bun.spawnSync([lsof, "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "cp"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    // `-F cp` writes one field per line: `p<pid>` then `c<command>`.
    const lines = new TextDecoder().decode(found.stdout).trim().split("\n");
    const pid = lines.find((l) => l.startsWith("p"))?.slice(1);
    const command = lines.find((l) => l.startsWith("c"))?.slice(1);
    if (!command) return null;
    return pid ? `${command} (pid ${pid})` : command;
  } catch {
    return null;
  }
}

/**
 * Say that the port is taken, in the terms someone can act on.
 *
 * A port in use is the one failure of `web` that is nobody's mistake — a server
 * left running in another window, another application that likes 3000 as much
 * as this one does — so it is answered with what is there and what to do about
 * it, rather than with a stack trace through Bun's listen call.
 */
function reportPortInUse(port) {
  const holder = whatHasPort(port);

  console.error(`mosaic: port ${port} is already in use.`);
  if (holder) console.error(`    ${holder} is listening on it.`);
  console.error(
    `    Serve on another port with \`--port ${port + 1}\`, or stop what is there.`,
  );
  // The likeliest cause by far, and the one whose fix is not "pick another
  // port": a `web` from an earlier session that is still up.
  console.error(`    A \`mosaic web\` left running in another window will do this.`);
}

/**
 * Start the server, turning the one error worth explaining into one that says
 * so. Everything else is a real failure and travels as it is.
 */
function listen(root, port, onResult = null, services = null) {
  try {
    return serve(root, port, onResult, services);
  } catch (e) {
    if (e?.code !== "EADDRINUSE") throw e;
    throw new PortInUse(port);
  }
}

function serve(root, port, onResult = null, services = null) {
  const base = path.resolve(root);

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);

      // The application's own services, if it has any. Answered before
      // anything is looked for on disk: this path is not a file and never
      // was.
      if (services && url.pathname === RPC_PATH) {
        if (request.method !== "POST") {
          return new Response("rpc calls are POSTed", { status: 405 });
        }
        let message;
        try {
          message = await request.json();
        } catch {
          return Response.json(
            { id: null, error: { name: "BadRequest", message: "an rpc call is JSON" } },
            { status: 400 },
          );
        }
        // 200 whatever the answer is: a service refusing a call is the
        // service's answer, not the request failing. The envelope says which
        // it was, and the client throws where the call was made.
        return Response.json(await dispatch(message, services, { request }));
      }

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
        // Always revalidate: the point of `web` is that a rebuild is visible.
        "cache-control": "no-store",
        ...(type ? { "content-type": type } : {}),
      };

      // A page being checked reports back when it is done. Nothing is added to
      // a page `web` serves: an application should be what it is.
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
 * TypeDoc, wherever this machine has it.
 *
 * Looked for nearest first — the application's own `node_modules`, then
 * mosaic's — and then on the PATH. An application that pins a version gets the
 * one it pinned, which matters for a theme or a plugin it also pins. Failing
 * all of those, `bunx` fetches it, which is said out loud rather than
 * appearing as a pause: it downloads a package.
 *
 * All of it under bun. TypeDoc is the TypeScript compiler with a writer on the
 * end of it and runs as ordinary code, so nothing here needs node — which is
 * why the documentation is made with this rather than with jsdoc, whose own
 * loader (requizzle, rewriting its modules as it imports them) bun has no
 * answer for and which therefore cannot run on a machine that has only bun.
 *
 * @returns {{command: string[], fetched: boolean}} How to run it.
 */
function findTypedoc(app) {
  const bun = Bun.which("bun");
  const local = [
    path.join(app.source, "node_modules", ".bin", "typedoc"),
    path.join(HOME, "node_modules", ".bin", "typedoc"),
  ].find((p) => fs.existsSync(p));
  if (local) return { command: bun ? [bun, local] : [local], fetched: false };

  const found = Bun.which("typedoc");
  if (found) return { command: [found], fetched: false };

  const bunx = Bun.which("bunx");
  if (bunx) return { command: [bunx, "--yes", "typedoc"], fetched: true };
  if (bun) return { command: [bun, "x", "--yes", "typedoc"], fetched: true };

  throw new Error(
    "TypeDoc is not installed and there is no bunx to fetch it with.\n" +
      "    Install it beside the application with `bun add -d typedoc`.",
  );
}

/**
 * The block tags and excluded tags TypeDoc knows, asked of TypeDoc itself.
 *
 * `blockTags` and `excludeTags` are lists that replace the defaults rather than
 * adding to them, so declaring one more tag means naming all forty-odd — and a
 * copy of either list kept here would go stale the first time TypeDoc changed
 * it, quietly un-declaring whatever it had added. Setting the option from a
 * plugin does not work either: it takes, and the comments have already been
 * parsed by the time it does.
 *
 * So TypeDoc is asked. `--help` loads the options and the plugins and then
 * prints its usage without converting anything, which takes about a fifth of a
 * second and is always right about the version actually in use.
 *
 * @returns {Promise<{blockTags: string[], excludeTags: string[]}|null>} The
 *   tags, or null if it could not be asked — in which case the tags are left
 *   alone and `@fires` goes on being rendered, which is a busier page rather
 *   than a failed run.
 */
async function knownTags(command, dir) {
  const file = path.join(dir, DOC_ASK);
  fs.writeFileSync(file, DOC_ASK_SOURCE);

  try {
    const proc = Bun.spawn([...command, "--plugin", file, "--help"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const said = await new Response(proc.stdout).text();
    await proc.exited;

    const line = said
.split("\n")
.find((l) => l.startsWith(DOC_ASK_MARKER));
    if (!line) return null;
    const tags = JSON.parse(line.slice(DOC_ASK_MARKER.length));
    if (!tags || !Array.isArray(tags.blockTags) || !Array.isArray(tags.excludeTags)) {
      return null;
    }
    return tags;
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * The frameworks documented alongside the application.
 *
 * An application built on a framework is documented with it: `DetailButton
 * extends Button` is most of what that class is, and a Button that is only a
 * name the page cannot follow leaves the reader where they started. Every
 * class in the chain — Button, the Control beneath it, the Component beneath
 * that — is a page, and the hierarchy is a hierarchy rather than one step and
 * a dead end.
 *
 * The frameworks are the ones ${CONFIG} names, so nothing arrives that the
 * application is not built against. `"frameworks": false` in the `doc` section
 * leaves them out for an application that would rather document only its own
 * code, and a list of names documents those and no others.
 */
function documentedFrameworks(config, docs) {
  const wanted = docs.frameworks ?? true;
  if (wanted === false) return [];

  const all = config.frameworks.filter((f) => fs.existsSync(f.input));
  if (wanted === true) return all;

  if (!Array.isArray(wanted)) {
    throw new Error(
      `${CONFIG}: "doc".frameworks is true, false, or a list of framework names`,
    );
  }
  for (const name of wanted) {
    if (!all.some((f) => f.name === name)) {
      throw new Error(
        `${CONFIG}: "doc".frameworks names "${name}", which is not one of the ` +
          `frameworks this application is built against` +
          (all.length > 0 ? ` — ${all.map((f) => f.name).join(", ")}` : ""),
      );
    }
  }
  return all.filter((f) => wanted.includes(f.name));
}

/**
 * What a framework's directories hold that is not a module of it.
 *
 * A theme is a stylesheet, and a catalog is JSON: neither exports anything, so
 * neither belongs in an index of what a framework exports.
 */
const FRAMEWORK_NOT_CODE = new Set([THEMES, LOCALES]);

/**
 * Stand in for the index a build generates for each framework, so a name
 * imported from one resolves while the documentation is being made.
 *
 * `mosaic/frameworks/ui` is a subpath of the package the compiler vendors, and
 * the module behind it is written by `writeFrameworkIndex` from whatever
 * compiled into the framework. `doc` compiles nothing, so it writes the same
 * index from the framework's sources instead, by the same rule: a module's
 * default export is the component, named for its file.
 *
 * It is a file of re-exports and nothing else. Nothing here is documented —
 * the frameworks are not this application's code and are not in `include` —
 * it exists so that `extends Button` names a class the compiler can find.
 *
 * @returns {object} Framework name to the file written for it.
 */
/**
 * Put each framework where TypeDoc can read it, and say where that is.
 *
 * A framework that is being documented is copied into the build first, rather
 * than read where it lies. Two things make that worth the copy, and both of
 * them are silent failures otherwise:
 *
 *   An installed mosaic lives in `~/.bun/lib/mosaic`, and everything under a
 *   dotted directory is hidden as far as a glob is concerned. TypeDoc expanded
 *   the entry point to nothing and said nothing about it: the application was
 *   documented, the framework was not, and the only sign was a page count.
 *
 *   Entry points far apart are walked from whatever they have in common. An
 *   application in one place and a framework in another can share nothing but
 *   the root of the filesystem, and the walk down to them goes through
 *   directories that are not readable — reported as `ENOENT: scandir`, naming
 *   nothing.
 *
 * Inside the build both go away: every entry point is under the application,
 * near it, and named plainly. A framework that is only being resolved against
 * and not documented is left where it is — nothing globs it.
 *
 * @returns {Array<{name, root, documented}>} Each framework and where to read it.
 */
function placeFrameworks(config, docs, dir) {
  const documented = new Set(
    documentedFrameworks(config, docs).map((f) => f.name),
  );

  const places = [];
  for (const framework of config.frameworks) {
    if (!fs.existsSync(framework.input)) continue;

    let root = framework.input;
    if (documented.has(framework.name)) {
      root = path.join(dir, DOC_SOURCES, framework.name);
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(root), { recursive: true });
      fs.cpSync(framework.input, root, { recursive: true });
    }
    places.push({
      name: framework.name,
      root,
      documented: documented.has(framework.name),
    });
  }
  return places;
}

function writeFrameworkBarrels(places, dir) {
  const barrels = {};

  for (const framework of places) {

    const lines = [
      `// ${framework.name} — generated by mosaic for \`doc\`, standing in for`,
      `// the index a build writes. Re-exports only; nothing here is documented.`,
      "",
    ];

    const walk = (from) => {
      for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const full = path.join(from, entry.name);
        if (entry.isDirectory()) {
          if (!FRAMEWORK_NOT_CODE.has(entry.name)) walk(full);
          continue;
        }
        if (path.extname(entry.name) !== ".js") continue;

        const specifier = JSON.stringify(full);
        const name = componentName(path.basename(entry.name, ".js"));
        if (/^\s*export\s+default\b/m.test(fs.readFileSync(full, "utf8"))) {
          lines.push(`export {default as ${name}} from ${specifier};`);
        }
        lines.push(`export * from ${specifier};`);
      }
    };
    walk(framework.root);

    const file = path.join(dir, `${DOC_BARRELS}/${framework.name}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n");
    barrels[framework.name] = file;
  }

  return barrels;
}

/**
 * The TypeScript configuration TypeDoc reads the sources through, written from
 * the application rather than kept by it.
 *
 * TypeDoc is built on the TypeScript compiler and so wants a `tsconfig.json`,
 * which is a file about a language this application is not written in. Rather
 * than make every application keep one, it is generated here: the options a
 * JavaScript application needs are the same ones every time, and `doc` in
 * ${CONFIG} says whatever is not.
 *
 * `allowJs` is the whole point of it — the sources are `.js` and are read as
 * they are. `checkJs` stays off: this is documentation, not type checking, and
 * an application whose JSDoc says something the compiler would argue with
 * should still be documented rather than refused.
 *
 * Types come from the JSDoc that is already there: `@param {string} name`
 * documents a string. A comment written without the braces documents an `any`,
 * which is TypeDoc reporting exactly what it was told.
 */
function writeDocTsconfig(config, app, dir, docs, places, barrels) {
  const file = path.join(dir, DOC_TSCONFIG);

  // Absolute, and not relative to the generated file.
  //
  // A relative one is what a tsconfig usually holds, and it is right up until
  // the two are not near each other: a build under `/private/tmp` and a
  // framework under `/Users` share only the filesystem root, and the climb
  // between them — eight `..` and then back down — walks through directories
  // that do not exist. TypeScript's own glob walker reads each level as it
  // goes and stops at the first that is missing, which it reports as a bare
  // `ENOENT: scandir` naming nothing.
  //
  // The file is generated on every run and read by one program, so there is
  // nothing for a relative path to buy: it is never moved, copied or
  // committed.
  const from = (p) => p.split(path.sep).join("/");

  // What to document: the tree `main_file` sits in, which is the application's
  // own code and exactly what `compile` walks, and the frameworks it is built
  // against. An application that wants more or less of it says so as tsconfig
  // patterns.
  const include = docs.include ?? [
    `${from(app.sourceRoot)}/**/*.js`,
...places
.filter((framework) => framework.documented)
.map((framework) => `${from(framework.root)}/**/*.js`),
  ];

  // Where the names an application imports actually are.
  //
  // `import {Button} from "mosaic/frameworks/ui"` resolves through the package
  // the compiler vendors into a build — which `doc` does not make, and which a
  // finished build has pruned away. Unresolved, `class DetailButton extends
  // Button` extends nothing the compiler knows: it was documented with no
  // hierarchy, no base class and none of the inherited members, which is most
  // of what a component's page is for.
  //
  // So the same names are pointed at the sources they are compiled from. The
  // frameworks are the ones ${CONFIG} names, found where `compile` finds them.
  const paths = { [config.runtimeSpecifier]: [from(config.runtime)] };
  for (const framework of places) {
    const specifier = `${config.runtimeSpecifier}/${FRAMEWORKS}/${framework.name}`;
    // The index, which is generated for a build and generated again here.
    if (barrels?.[framework.name]) {
      paths[specifier] = [from(barrels[framework.name])];
    }
    // And each component by its own path, which is how compiled markup names
    // one. Those need nothing generated: they are the source files.
    paths[`${specifier}/*`] = [`${from(framework.root)}/*`];
  }

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          checkJs: false,
          noEmit: true,
          module: "esnext",
          target: "esnext",
          moduleResolution: "bundler",
          // A `.ib.xml` compiles to JSX, and a component's module may hold it.
          // Named so the compiler can parse what it finds rather than stopping
          // at the first tag.
          jsx: "preserve",
          // No `baseUrl`: it is deprecated, and TypeScript refuses outright
          // rather than warning. A relative path here is relative to this
          // file, which is what is wanted anyway.
          paths,
...(docs.compilerOptions ?? {}),
        },
        include,
      },
      null,
      2,
    ) + "\n",
  );
  return file;
}

/**
 * A TypeDoc plugin that gives a default export the name it was written with.
 *
 * `export default class Button` has one export and its name is `default` —
 * that is what the module exports it as, and TypeDoc says so. It is also
 * every component in this framework, so a documented application came out as
 * a list of classes all called "default", told apart only by the module above
 * them. The declaration has a perfectly good name and it is two steps away.
 *
 * Taken from the symbol, which is the compiler's own record of the
 * declaration: `export default class Button` is a symbol exported as `default`
 * whose declaration is named `Button`. Nothing here parses anything.
 *
 * An anonymous default — `export default {…}`, which is how a service module
 * is written — has no declared name to find, and is named for its module
 * instead: `greeting.js` documents `greeting`. That is what the file is called
 * everywhere else, including in the call that reaches it.
 *
 * Written as source rather than shipped as a file because it is part of what
 * the build generates, beside the two configs. It imports nothing: a plugin
 * that imports `typedoc` has to resolve it, and the copy `bunx` fetches sits
 * in a cache where `typescript` cannot be resolved from — the event names are
 * strings, so nothing needs importing at all.
 */
const DOC_PLUGIN_SOURCE = `// Generated by mosaic. Written fresh on every \`mosaic doc\`.
//
// The name a file gives what it holds, which is mosaic's rule everywhere: a
// component is named for its module, \`detail_button.js\` for a DetailButton.
// The same one the compiler applies, said again here because a generated
// plugin imports nothing.
function componentName(stem) {
  let out = "";
  let upper = true;
  for (const c of stem) {
    if (c === "-" || c === "_" || c === " " || c === ".") upper = true;
    else if (upper) {
      out += c.toUpperCase();
      upper = false;
    } else out += c;
  }
  out = [...out].filter((c) => /[\\p{L}\\p{N}_$]/u.test(c)).join("");
  if (out === "" || /^\\d/.test(out)) out = "_" + out;
  return out;
}
//
// A default export is exported as "default", which is the name TypeDoc gives
// it. This gives it back the name it was declared with, so a framework whose
// components are each \`export default class\` is not documented as a list of
// classes all called the same thing.

export function load(app) {
  // Only what an author marks \`@public\` is documented. \`@internal\` is dropped
  // already (excludeInternal); this makes the surface opt-in rather than
  // opt-out, so a method, accessor or prop reaches a page only when it says to.
  //
  // TypeDoc reads \`@public\` as a visibility modifier and records it as the
  // \`isPublic\` flag on the reflection — a method, an accessor and an object
  // literal's property each carry it — so that is what is asked, not the tag.
  const isPublic = (reflection) => reflection.flags?.isPublic === true;

  // Reflection kinds, as TypeDoc numbers them (a generated plugin imports
  // nothing — see componentName). A class member is a property, a method or an
  // accessor whose parent is the class itself; a prop entry, whose parent is
  // the \`static props\` object, is filtered separately when the table is built.
  const CLASS = 128,
    PROPERTY = 1024,
    METHOD = 2048,
    ACCESSOR = 262144;

  app.converter.on("resolveEnd", (context) => {
    const project = context.project;
    const doomed = [];
    for (const reflection of Object.values(project.reflections)) {
      if (reflection.parent?.kind !== CLASS) continue;
      if (
        reflection.kind !== PROPERTY &&
        reflection.kind !== METHOD &&
        reflection.kind !== ACCESSOR
      )
        continue;
      // \`static props\` is the component's public surface, turned into a table
      // below and filtered there prop by prop; the member itself stays.
      if (reflection.name === "props" && reflection.flags?.isStatic) continue;
      if (!isPublic(reflection)) doomed.push(reflection);
    }
    for (const reflection of doomed) project.removeReflection(reflection);
  });

  app.converter.on("createDeclaration", (context, reflection) => {
    if (reflection.name !== "default") return;

    // The compiler's record of what was declared. \`export default class Foo\`
    // is a symbol exported as "default" whose declaration is named "Foo".
    const symbol = context.getSymbolFromReflection?.(reflection);
    const declared = symbol?.declarations
      ?.map((d) => d?.name?.escapedText ?? d?.name?.text)
.find((name) => typeof name === "string" && name.length > 0);

    // An anonymous default has none, and is named for its module: that is what
    // the file is called, and what everything that reaches it calls it.
    reflection.name = declared ?? reflection.parent?.name ?? reflection.name;
  });

  // And the classes an application extends, which are somebody else's.
  //
  // \`class DetailButton extends Button\` reaches a Button that is itself an
  // \`export default\`, in a framework that is not part of what is being
  // documented — so there is no declaration here to take a name from, only a
  // reference to one, and it renders as "default extends DetailButton". The
  // compiler does record where it came from, and a component is named for its
  // file everywhere else in mosaic, so it is named for its file here.
  app.converter.on("resolveEnd", (context) => {
    for (const reflection of Object.values(context.project.reflections)) {
      for (const type of [
...(reflection.extendedTypes ?? []),
...(reflection.implementedTypes ?? []),
      ]) {
        if (type?.name !== "default") continue;
        const file = type.symbolId?.fileName;
        if (typeof file !== "string") continue;
        const stem = file.split("/").pop().replace(/\\.[^.]*$/, "");
        if (stem) type.name = componentName(stem);
      }
    }
  });

  // And what a component actually takes.
  //
  // \`static props\` is the published surface — what markup may set on the tag —
  // and it was documented as the object literal it happens to be written as:
  // one long type, \`{ text: { type: StringConstructor; default: string }, … }\`,
  // with each prop's own comment folded inside it and the whole unreadable at
  // a glance.
  //
  // It was also short. \`{...Button.props, description}\` does reach the
  // compiler — the spread is expanded — but a prop an ancestor declares and
  // nobody spreads in does not: a Button never mentions Control's, so a
  // DetailButton's page listed neither \`controlId\` nor \`name\`. The classes it
  // extends are walked for those, which is where they were all along.
  app.converter.on("resolveEnd", (context) => {
    const project = context.project;

    // TypeDoc's Comment, taken from one it made rather than imported: this
    // plugin has nothing to import from (see the note on \`componentName\`).
    const Comment = Object.values(project.reflections).find(
      (r) => r.comment,
    )?.comment?.constructor;
    if (!Comment) return;

    /** The text of a comment, as one line. */
    const summaryOf = (reflection) =>
      (reflection?.comment?.summary ?? [])
.map((part) => part.text ?? "")
.join("")
.replace(/\\s+/g, " ")
.trim();

    /** \`{type: String, default: ""}\` read back as something to put in a table. */
    const detailOf = (prop) => {
      const inner = prop.type?.declaration?.children ?? [];
      const named = (name) => inner.find((child) => child.name === name);

      // \`type: String\` is the String *constructor*, which is how a value says
      // what type it is in a language with no types to declare.
      const declared = named("type")?.type;
      const kind = (declared?.name ?? "")
.replace(/Constructor$/, "")
.trim();

      // The default, when the compiler kept the value. An object literal is
      // not \`as const\`, so \`default: ""\` widens to the type \`string\` and the
      // value is gone — and printing "string" in a Default column says
      // something false. What is not known is left blank.
      const fallback = named("default")?.type;
      const widened = ["string", "number", "boolean", "any"];
      const shown =
        fallback && "value" in fallback
          ? JSON.stringify(fallback.value)
          : widened.includes(fallback?.name)
            ? ""
            : (fallback?.name ?? "");

      return { kind, shown };
    };

    /** Every prop a class takes, nearest declaration winning. */
    const propsOf = (klass, seen = new Set()) => {
      if (!klass || seen.has(klass)) return new Map();
      seen.add(klass);

      // The classes it extends first, so its own declarations write over them:
      // a subclass redeclaring a prop is narrowing the one it inherited.
      const gathered = new Map();
      for (const base of klass.extendedTypes ?? []) {
        for (const [name, entry] of propsOf(base.reflection, seen)) {
          // The class it was declared by, taken from the resolved reflection:
          // a reference to a default-exported base is still called "default",
          // and the renaming above reaches only the ones outside this project.
          gathered.set(name, {
...entry,
            from: entry.from ?? base.reflection?.name ?? base.name,
          });
        }
      }

      const own = klass.children?.find(
        (child) => child.name === "props" && child.flags?.isStatic,
      );
      for (const prop of own?.type?.declaration?.children ?? []) {
        // A prop is documented only when it is marked \`@public\`, the same rule
        // the members follow.
        if (!isPublic(prop)) continue;
        gathered.set(prop.name, {
...detailOf(prop),
          says: summaryOf(prop),
          from: null,
        });
      }
      return gathered;
    };

    for (const reflection of Object.values(project.reflections)) {
      const own = reflection.children?.find(
        (child) => child.name === "props" && child.flags?.isStatic,
      );
      if (!own) continue;

      const props = propsOf(reflection);
      if (props.size === 0) {
        // Nothing public to show — take the raw \`props\` member off the page
        // rather than leaving its object literal to render on its own.
        project.removeReflection(own);
        continue;
      }

      // The \`props\` member still renders its declared type — the object
      // literal — so a non-public prop would show there even though it is kept
      // out of the table. Trim the literal to the public props as well.
      if (own.type?.declaration?.children) {
        own.type.declaration.children =
          own.type.declaration.children.filter((child) => isPublic(child));
      }

      const rows = [...props]
.sort(([a], [b]) => a.localeCompare(b))
.map(([name, entry]) => {
          const said = entry.says || "";
          // Where an inherited one was declared, so a component's own are
          // told apart from what it is a kind of.
          const where = entry.from ? \` _(\${entry.from})_\` : "";
          return \`| \\\`\${name}\\\` | \${entry.kind || "—"} | \${
            entry.shown ? \`\\\`\${entry.shown}\\\`\` : "—"
          } | \${said}\${where} |\`;
        });

      const table = [
        "What markup may set on this component, its own and inherited:",
        "",
        "| Prop | Type | Default | |",
        "| --- | --- | --- | --- |",
...rows,
      ].join("\\n");

      const already = summaryOf(own);
      own.comment = new Comment([
        { kind: "text", text: already ? \`\${already}\\n\\n\${table}\` : table },
      ]);
    }
  });

  // And put it first.
  //
  // Properties are listed alphabetically, so the one that says what the
  // component takes sat wherever its name fell — a Button's after \`hasIcon\`,
  // a DetailButton's after \`description\`. It is the first thing to read about
  // a component, so it is the first thing on the page.
  //
  // At render rather than at resolve: the groups a page is laid out from do
  // not exist until then, and reordering the children before they are grouped
  // changes nothing.
  app.renderer.on("beginPage", (page) => {
    const lift = (list) => {
      const at = list?.findIndex(
        (child) => child.name === "props" && child.flags?.isStatic,
      );
      // Already first, or not here at all.
      if (!(at > 0)) return;
      list.unshift(list.splice(at, 1)[0]);
    };

    for (const group of page.model?.groups ?? []) {
      lift(group.children);
      for (const category of group.categories ?? []) lift(category.children);
    }
  });
}
`;

/**
 * TypeDoc's own options, written from the `doc` section.
 *
 * Everything in that section but the two keys about the sources is TypeDoc's,
 * passed through untouched: an application says `name`, `readme`,
 * `excludePrivate` or anything else TypeDoc takes, and mosaic neither knows
 * nor needs to know what they mean. What mosaic settles is where the sources
 * are and where the output goes, which is what it was asked.
 */
function writeDocOptions(config, app, dir, docs, places, outdir, blockTags, excludeTags) {
  const file = path.join(dir, DOC_OPTIONS);

  // The keys mosaic reads rather than passes on: the two about the TypeScript
  // side, and which frameworks to document. Left in, TypeDoc refuses the lot
  // with "Unknown option 'frameworks'". `excludeTags` is pulled out too — an
  // application may add its own, and those are folded into mosaic's rather than
  // one list silently replacing the other.
  const { compilerOptions, include, frameworks, excludeTags: appExcludeTags,...options } = docs;

  // What mosaic excludes (`@fires`, atop TypeDoc's defaults) plus anything the
  // application named, with no tag listed twice.
  const mergedExcludeTags = [
...(excludeTags ?? []),
...(Array.isArray(appExcludeTags) ? appExcludeTags : []),
  ].filter((tag, i, all) => all.indexOf(tag) === i);

  // A readme is the application's file, so it is resolved against the
  // application and not against the generated config it is named in.
  if (typeof options.readme === "string" && options.readme !== "none") {
    options.readme = path.resolve(app.source, options.readme);
  }

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        // The folder, expanded into the files under it: `expand` is what makes
        // an entry point a directory rather than one module, which is how an
        // application laid out as a tree of components is documented.
        //
        // And the frameworks it is built against, so the classes it extends
        // are pages rather than names — see `documentedFrameworks`.
        entryPoints: [
          app.sourceRoot,
...places.filter((f) => f.documented).map((f) => f.root),
        ],
        entryPointStrategy: "expand",
        tsconfig: path.join(dir, DOC_TSCONFIG),
        out: outdir,
        // Named for whatever is being documented — an application or a
        // framework — unless the section says otherwise, so the title is right
        // without anything being written for it.
        name: config.app_name ?? config.framework_name ?? app.name,
        // What TypeDoc already knows, plus the tags mosaic writes its sources
        // with. Left out, `@fires` warned once per component and the line
        // saying what it fires was dropped from the page.
...(blockTags ? { blockTags } : {}),
        // `@fires` is a known tag now, but its section — what a component emits
        // — is excluded rather than rendered, so the page does not carry it.
        // Built onto TypeDoc's defaults and any the application adds; see
        // `mergedExcludeTags`.
...(mergedExcludeTags.length > 0 ? { excludeTags: mergedExcludeTags } : {}),
        // `@internal` is a component's own working out — the node it drew, the
        // tree it drew last — and is marked so precisely because it is not the
        // published surface. Listed under Properties beside the props a page
        // sets, it reads as part of that surface, and the useful half is
        // buried in it. TypeDoc shows them with a badge by default; here they
        // are left out, and `"excludeInternal": false` puts them back.
        excludeInternal: true,
...options,
        // Last, and added to rather than replaced: an application naming a
        // plugin of its own gets it, and still gets its default exports named
        // for what they are.
        plugin: [
          path.join(dir, DOC_PLUGIN),
...(Array.isArray(options.plugin)
            ? options.plugin
            : options.plugin
              ? [options.plugin]
              : []),
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return file;
}

/**
 * Document the application's sources.
 *
 * The folder documented is the application's own code — the tree `main_file`
 * sits in, which is what `compile` walks — so the two commands are about the
 * same thing and neither reaches above it. The sources are read as they are,
 * so this compiles nothing and needs no build: an application that does not
 * currently bundle can still be documented, which is when documentation is
 * often most wanted.
 *
 * Output lands in `build/doc/` unless `--outdir` names somewhere else, in
 * which case it goes exactly there — for documentation published somewhere a
 * build directory is not.
 */
async function documentation(config, app, args) {
  const log = args.quiet ? () => {} : (...a) => console.log(...a);

  // `--outdir` is the documentation's own destination here, and nothing else:
  // a command whose only output is documentation has nowhere else to mean, so
  // unlike everywhere else it does not move the build directory.
  const outdir = args.outdir ?? path.join(app.outdir, DOC_DIR);

  // Every `.js` under the application's own source tree — the folder
  // `main_file` sits in — read as it is, with no build and no dependency. A
  // directory named `private` is left out, and each file is documented for
  // what it is: a class, a module of functions, or a Mosaic component.
  const inputDir = app.sourceRoot;

  log(`==> documenting ${within(config.root, inputDir)}`);
  const { count, index } = generateDocs(inputDir, outdir, { title: args.title });
  log("==> documented");
  log(`    ${count} file${count === 1 ? "" : "s"} → ${within(config.root, index)}`);
  return 0;
}

/**
 * Install what the application says it depends on.
 *
 * `bun install`, with `dependencies` in `info.json` standing in for the
 * package.json an application does not have — for the first checkout of a
 * project, for a CI step that wants the download over with before the build,
 * and for changing a version and having it take effect without running the app.
 *
 * Asked for, it is done: unlike the install `desktop` performs on its way to
 * launching, this one does not decide the dependencies look current and skip.
 *
 * Where they land depends on what the application is, and it is looked at
 * rather than assumed. A desktop app's dependencies belong to the project
 * `desktop` generates, because that project is what is bundled and shipped and
 * what Electrobun has to be found in. A page's are ordinary dependencies of an
 * ordinary directory, and go where anyone would look for them — beside the
 * application, where the bundler resolves imports from.
 *
 * Presuming the first of those cost every page an error: writing the desktop
 * project needs a main process, and a page has none to write.
 */
async function install(config, app, args) {
  const log = args.quiet ? null : (...a) => console.log(...a);

  if (fs.existsSync(path.join(app.bunDir, BUN_ENTRY))) {
    return installDesktop(config, app, log);
  }
  return installPage(config, app, log);
}

/**
 * A desktop app: install into the project `desktop` generates.
 *
 * There is always something to install even when the application named
 * nothing: what a desktop app is built out of is not its own dependency, but
 * it does have to be here.
 */
async function installDesktop(config, app, log) {
  const dir = path.join(app.outdir, DESKTOP_DIR);
  const project = writeProject({ app, config, dir });

  log?.(`==> installing into ${path.relative(config.root, dir) || "."}`);
  await installDependencies({ ...project, needsInstall: true, log: null });

  const names = Object.keys(project.dependencies);
  log?.(`    ${names.length > 0 ? names.join(", ") : "nothing declared"}`);
  return 0;
}

/**
 * A page: `bun install` where the application is, told what to install by
 * `info.json`.
 *
 * The dependencies are read from `info.json` and handed to bun as `name@version`
 * arguments, which leaves the package.json to bun. Mosaic writing one would be
 * a generated file in a source tree — a file someone will edit, and then find
 * overwritten — and bun already writes the two lines it needs when given
 * packages and finding none there.
 *
 * An application whose package.json says more than `info.json` can is not
 * argued with: what is passed is what `info.json` declares, and everything else
 * already in the file is installed along with it, as a plain `bun install`
 * would.
 */
async function installPage(config, app, log) {
  const dir = app.source;
  const declared = config.dependencies ?? {};
  const packages = Object.entries(declared).map(([name, version]) =>
    version ? `${name}@${version}` : name,
  );

  // Nothing declared and no package.json to fall back on. Said rather than
  // done: bun has nothing to install from and reports as much, which is a
  // failure where this is an application that simply depends on nothing.
  if (packages.length === 0 && !fs.existsSync(path.join(dir, "package.json"))) {
    log?.(`==> nothing to install — ${CONFIG} declares no dependencies`);
    return 0;
  }

  log?.(`==> installing into ${path.relative(config.root, dir) || "."}`);
  await installDependencies({ dir, packages, needsInstall: true, log: null });

  const names = Object.keys(declared);
  log?.(`    ${names.length > 0 ? names.join(", ") : "package.json"}`);
  return 0;
}

/**
 * Copy a framework into the application's own `frameworks/` and name it in
 * `info.json`.
 *
 * Two halves, and both are needed: the tree has to be here, and the
 * application has to say it is built against it — a framework sitting in the
 * directory that nothing names is not in scope, which is the whole point of
 * naming them.
 *
 * Copied rather than referenced, so what an application builds against is in
 * the repository with it: it can be read, patched, and committed, and a build
 * does not depend on which mosaic happens to be installed. `resolveFramework`
 * looks here first for exactly this reason.
 */
function installFramework(dir, name, args) {
  const builtIn = path.join(HOME, "src/js", FRAMEWORKS);
  const source = path.join(builtIn, name);
  if (!fs.existsSync(source)) {
    const available = fs.existsSync(builtIn)
      ? fs
          .readdirSync(builtIn, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
    throw new Error(
      `mosaic ships no framework named "${name}"` +
        (available.length > 0 ? ` — it has ${available.join(", ")}` : ""),
    );
  }

  const dest = path.join(dir, FRAMEWORKS, name);
  if (fs.existsSync(dest)) {
    throw new Error(
      `${path.relative(dir, dest)} is already here — remove it to install ` +
        `"${name}" again`,
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });

  const named = nameFramework(path.join(dir, CONFIG), name);

  const log = args.quiet ? null : (...a) => console.log(...a);
  log?.(`==> installed ${name}`);
  log?.(`    ${path.relative(dir, dest) || "."}`);
  log?.(
    named
      ? `    ${CONFIG}: "${FRAMEWORKS}" now names ${name}`
      : `    ${CONFIG}: already named ${name}`,
  );
  return 0;
}

/**
 * Add `name` to the `frameworks` list in the config at `file`, if it is not
 * already there. Rewritten rather than regenerated, so every other key keeps
 * its place and its formatting.
 *
 * @returns {boolean} whether anything was added.
 */
function nameFramework(file, name) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const listed = Array.isArray(data[FRAMEWORKS]) ? data[FRAMEWORKS] : [];
  const already = listed.some((entry) =>
    typeof entry === "string" ? entry === name : entry?.name === name,
  );
  if (already) return false;

  data[FRAMEWORKS] = [...listed, name];
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return true;
}

/**
 * Copy a theme's stylesheet into the application's own `themes/`.
 *
 * A theme is one stylesheet of custom properties, so installing one is one
 * file — no module, no import, nothing generated. What makes it reachable is
 * where it lands: a build looks in the application's `themes/` before the ones
 * a framework ships, so a theme installed here is found by name and can stand
 * in for a framework's own of the same name.
 *
 * Wearing it is still the application's to say. `theme` in the config names
 * the one a page starts in and `themes` names any others the build carries, so
 * this reports what to write rather than writing it: which theme an
 * application wears is a decision, not a consequence of having fetched one.
 */
function installTheme(dir, name, args) {
  const source = shippedTheme(name);
  if (!source) {
    const available = shippedThemeNames();
    throw new Error(
      `mosaic ships no theme named "${name}"` +
        (available.length > 0 ? ` — it has ${available.join(", ")}` : ""),
    );
  }

  const dest = path.join(dir, THEMES, `${name}.css`);
  if (fs.existsSync(dest)) {
    throw new Error(
      `${path.relative(dir, dest)} is already here — remove it to install ` +
        `"${name}" again`,
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);

  const log = args.quiet ? null : (...a) => console.log(...a);
  log?.(`==> installed ${name}`);
  log?.(`    ${path.relative(dir, dest)}`);
  log?.(`    wear it with "${THEME_SUBJECT}": "${name}" in ${CONFIG}`);
  return 0;
}

/** Every theme mosaic ships, across the frameworks it ships. */
function shippedThemeDirs() {
  const root = path.join(HOME, "src/js", FRAMEWORKS);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name, THEMES))
    .filter((dir) => fs.existsSync(dir));
}

function shippedThemeNames() {
  const names = new Set();
  for (const dir of shippedThemeDirs()) {
    for (const file of fs.readdirSync(dir)) {
      if (path.extname(file) === ".css") names.add(path.basename(file, ".css"));
    }
  }
  return [...names].sort();
}

/** Where a theme mosaic ships is read from, or null if it ships none. */
function shippedTheme(name) {
  for (const dir of shippedThemeDirs()) {
    const file = path.join(dir, `${name}.css`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Build the application into something this platform can install and run.
 *
 * Electrobun's `stable` channel, which is its production one: `dev` is what a
 * `desktop dev` run uses and carries the machinery for reloading, and `canary`
 * is a pre-release channel an application would have to have opinions about
 * updates to want. A `prod` build is the one you hand to somebody.
 *
 * Nothing is launched. What comes out is an application bundle for the platform
 * this ran on — mosaic cross-compiles nothing, and neither does Electrobun —
 * beside whatever that platform is installed from.
 */
async function build(config, app, { dir, run, log }) {
  const shipping = { ...(config.desktop ?? {}) };

  // Credentials are read by Electrobun from the environment, deep into a build
  // that has already taken a minute. Checked here instead, where the answer
  // costs nothing and names the variable that is missing.
  const needed = [];
  if (shipping.codesign) needed.push("ELECTROBUN_DEVELOPER_ID");
  if (shipping.notarize) {
    needed.push("ELECTROBUN_APPLEID");
    // Apple takes either an app-specific password with a team, or an API key.
    const byKey = process.env.ELECTROBUN_APPLEAPIKEY;
    if (!byKey) needed.push("ELECTROBUN_APPLEIDPASS", "ELECTROBUN_TEAMID");
  }
  const missing = needed.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `"desktop" in ${CONFIG} asks for ${
        shipping.notarize ? "signing and notarising" : "signing"
      }, and the environment does not carry ${missing.join(", ")}.\n` +
        "    They are credentials, so they belong in the environment rather " +
        `than in ${CONFIG}.`,
    );
  }

  log?.("==> building for this platform");
  const asked = ["cef", "codesign", "notarize", "dmg"].filter(
    (k) => shipping[k],
  );
  if (asked.length > 0) log?.(`    ${asked.join(", ")}`);

  const started = Date.now();
  const proc = run("build", "--env=stable");
  const code = await proc.exited;
  if (code !== 0) throw new Error(`\`electrobun build\` failed (exit ${code})`);

  // Where Electrobun leaves it: a build directory named for the channel and the
  // platform, and an `artifacts/` beside it holding the installable forms.
  const built = path.join(dir, "build", `stable-${platformTag()}`);
  const artifacts = path.join(dir, "artifacts");
  const say = (p) => path.relative(config.root, p) || ".";

  unpack({ dir, built, artifacts, log });

  log?.(`    built in ${Math.round((Date.now() - started) / 1000)}s`);

  for (const [what, where] of [
    ["bundle", built],
    ["artifacts", artifacts],
  ]) {
    if (!fs.existsSync(where)) continue;
    log?.(`    ${what} ${say(where)}`);
    for (const name of fs.readdirSync(where).sort()) {
      const full = path.join(where, name);
      const size = fs.statSync(full).isDirectory() ? "" : ` (${bytes(full)})`;
      log?.(`        ${name}${size}`);
    }
  }

  return 0;
}

/**
 * Replace the self-extracting bundle with the application it holds.
 *
 * What a `stable` build leaves in the build directory is not the app: it is a
 * small bundle carrying the app as a compressed tarball, which unpacks itself
 * into Application Support on first run and starts the real one from there.
 * That is how an application ships and updates itself in the field, and it is
 * the wrong thing to be handed by a build — the app appears to start, quit and
 * start again, and what runs afterwards is a copy somewhere else.
 *
 * So the tarball is unpacked here, and what it holds replaces the extractor.
 * The result is the same bundle that would have existed after a first run, and
 * it runs when opened. The compressed form stays in `artifacts/`, which is
 * where the thing you upload belongs.
 *
 * Done with the tools Electrobun already installed: its own `zig-zstd`, and
 * tar. Nothing is added to the project for this.
 */
function unpack({ dir, built, artifacts, log }) {
  if (!fs.existsSync(artifacts)) return;
  const compressed = fs
    .readdirSync(artifacts)
    .filter((n) => n.endsWith(".app.tar.zst"))
    .map((n) => path.join(artifacts, n))[0];
  if (!compressed) return;

  const zstd = path.join(
    dir,
    "node_modules",
    "electrobun",
    `dist-${platformTag()}`,
    "zig-zstd",
  );
  if (!fs.existsSync(zstd)) return;

  const tar = path.join(dir, "build", `${path.basename(compressed, ".zst")}`);
  const decompressed = Bun.spawnSync(
    [zstd, "decompress", "-i", compressed, "-o", tar, "--no-timing"],
    { stdout: "ignore", stderr: "inherit" },
  );
  if (!decompressed.success) {
    log?.("    (left the self-extracting bundle: it could not be unpacked)");
    return;
  }

  try {
    // The extractor bundle goes first: the tarball holds an `.app` of the same
    // name, and untarring over it would merge the two.
    for (const name of fs.readdirSync(built)) {
      if (name.endsWith(".app")) {
        fs.rmSync(path.join(built, name), { recursive: true, force: true });
      }
    }
    const untarred = Bun.spawnSync(["tar", "-xf", tar, "-C", built], {
      stdout: "ignore",
      stderr: "inherit",
    });
    if (!untarred.success) throw new Error("tar failed");

    // The compressed copy Electrobun leaves beside the app is the same one in
    // `artifacts/`. One of them is what you upload; the other is clutter next
    // to the thing you run.
    for (const name of fs.readdirSync(built)) {
      if (name.endsWith(".tar.zst")) fs.rmSync(path.join(built, name));
    }
  } finally {
    fs.rmSync(tar, { force: true });
  }
}

/** How Electrobun names the platform it is building for. */
function platformTag() {
  const os = { darwin: "macos", win32: "win", linux: "linux" }[process.platform];
  const arch = { arm64: "arm64", x64: "x64" }[process.arch];
  return `${os ?? process.platform}-${arch ?? process.arch}`;
}

/** A file's size, said the way a person reads it. */
function bytes(file) {
  const n = fs.statSync(file).size;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
  const prod = args.mode === "prod";
  const project = writeProject({ app, config, dir, prod });
  const log = args.quiet ? null : (...a) => console.log(...a);

  log?.(`==> desktop ${path.relative(config.root, dir) || "."}`);
  if (project.services.length > 0) {
    log?.(`    services ${project.services.join(", ")}`);
  }

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
  const run = (...argv) =>
    Bun.spawn(bun ? [bun, electrobun, ...argv] : [electrobun, ...argv], {
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

  // `prod` builds rather than runs, and that is the whole difference: the same
  // generated project, handed to Electrobun with a channel instead of a window.
  if (prod) return await build(config, app, { dir, run, log });

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
  // The application's own directory — the one holding the `info.json` this run
  // is about, which is what `install framework` writes to.
  let source;
  try {
    args = parseArgs(argv);
    // `init` creates the application the other commands need, so it runs
    // before any of them is resolved.
    // `init desktop` is about an application that already exists, so unlike
    // `init <name>` it is resolved against one rather than creating a
    // directory. The word wins over a directory of the same name, which is a
    // trade worth making: `desktop` is a thing to add to an app far more often
    // than it is a name to give one.
    if (args.command === "init" && args.entry === DESKTOP_DIR) {
      return initDesktop();
    }
    if (args.command === "init") return init(args.entry);
    source = resolveApp(args.entry);
    config = loadConfig(source);
    // Said on the command line, it wins over the config: already absolute, so
    // it means the same thing after the chdir below.
    //
    // Except for `doc`, where it names where the documentation goes and
    // nothing else. That command's only output is the documentation, so
    // moving the build directory as well would be moving something it does
    // not write.
    if (args.outdir && args.command !== "doc") config.outdir = args.outdir;
    // Paths in the config are relative to the config that declared them, and
    // are absolute by now; the application's directory is where the rest of a
    // run is anchored.
    process.chdir(config.root);
    // `doc` documents whatever the sources are, so it is the one command
    // that does not need a bootstrap to point at.
    app = layout(config, source, { mayLackMain: args.command === "doc" });
  } catch (e) {
    // The usage text answers a command written wrongly. It has no answer for a
    // directory that holds no application, so that one is said on its own.
    console.error(
      e instanceof NoApplication
        ? `mosaic: ${e.message}`
        : `mosaic: ${e.message}\n\n${BRIEF}`,
    );
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

  // Documentation is made from the sources, so it does not wait on a build
  // either — and an application whose bundle is broken is one whose
  // documentation is still worth reading.
  if (args.command === "doc") {
    try {
      return await documentation(config, app, args);
    } catch (e) {
      report(e);
      return 1;
    }
  }

  // Installing is not building, and does not wait on a build: an application
  // whose dependencies are not there yet is exactly the one that cannot
  // compile, and telling it to compile first would be a circle.
  if (args.command === "install") {
    try {
      if (args.subject === FRAMEWORK_SUBJECT) {
        return installFramework(source, args.name, args);
      }
      if (args.subject === THEME_SUBJECT) {
        return installTheme(source, args.name, args);
      }
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

  // `compile watch`: the build is kept current and nothing is served — `web`
  // with the server taken out. What picks it up — another server, a packager,
  // a browser opened by hand — is somebody else's business, which is the point
  // of the word.
  if (args.command === "compile" && args.keepWatching) {
    console.log(`==> build ${within(config.root, app.outdir)}`);
    const watched = watchSources(config, app, args);
    console.log(
      `    watching ${watched.map((d) => path.relative(config.root, d) || ".").join(", ")}`,
    );
    console.log("    Ctrl-C to stop");
    // Nothing is listening, so nothing holds the process up: the watches do.
    return await new Promise(() => {});
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

  // `web` serves the application directory, so a page can only reach what
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

  // The services an application publishes, loaded before the first request
  // rather than on demand: a service that cannot be imported is worth hearing
  // about when the server starts, not the first time a page calls one.
  let rpc = null;
  if (args.command !== "check") {
    try {
      rpc = await loadServices(app);
    } catch (e) {
      console.error(`mosaic: the application's services could not be loaded`);
      report(e);
      return 1;
    }
  }

  // `check` asks for port 0 — whatever is free — so it is the one path here
  // that cannot collide with anything.
  let server;
  try {
    server =
      args.command === "check"
        ? serve(checkRoot, 0, reportResult)
        : listen(app.source, args.port, null, rpc?.services ?? null);
  } catch (e) {
    if (!(e instanceof PortInUse)) throw e;
    reportPortInUse(e.port);
    return 1;
  }

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
  if (rpc) {
    console.log(`    rpc ${RPC_PATH}: ${rpc.methods.join(", ")}`);
  }
  if (args.watch) {
    // Put the server back on the same port after a rebuild. It reads from disk
    // on every request, so this changes nothing about what it answers — what it
    // does is make one thing true of both commands: `dev` runs the application
    // again after an edit, and there is no rule about which edits count.
    const restart = async () => {
      const port = server.port;
      server.stop(true);
      // Re-imported, so an edited service is the one being called after a
      // rebuild — the whole point of watching.
      try {
        rpc = await loadServices(app);
      } catch (e) {
        console.error(`mosaic: the application's services could not be loaded`);
        report(e);
      }
      try {
        server = listen(app.source, port, null, rpc?.services ?? null);
      } catch (e) {
        if (!(e instanceof PortInUse)) throw e;
        // The port was ours a moment ago, so something took it in the gap
        // between stopping and starting. There is no serving on from here and
        // nothing to wait for, so it is said and the run ends — rather than
        // watching on with nothing listening, which looks like the rebuild
        // silently failing.
        reportPortInUse(e.port);
        process.exit(1);
      }
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
