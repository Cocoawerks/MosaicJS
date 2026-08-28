// TeaVM integration: server-side JVM code compiled to JavaScript and folded
// into the bundle.
//
// An `info.json` with a `shared` directory names a tree of `.java` that runs on
// the JVM but is wanted in the browser too — geometry, a solver, whatever a page
// and a server both have to agree about. This compiles it once, here, so the
// page carries the same code the server does rather than a second copy written
// in another language.
//
// The pipeline is two tools. `javac` turns the `.java` into bytecode, and TeaVM
// turns that bytecode into a JavaScript module. TeaVM reads bytecode rather than
// source, which is why javac runs first; it substitutes its own implementation
// of the `java.*` classes at translation time, so the shared code may use only
// what TeaVM supports — or classes the shared directory writes itself.
//
// What crosses into JavaScript is what the code marks `@JSExport`. TeaVM
// tree-shakes from an entry point and would drop an exported class nothing
// reaches, so mosaic generates an entry that names every `@JSExport` type —
// the shared code needs no `main` of its own.
//
// TeaVM is not shipped with mosaic. Its jars are fetched from Maven Central the
// first time they are wanted and cached under the home directory, so a build is
// self-contained after that and needs the network only once. A JDK — `java` and
// `javac` — has to be on the PATH; there is no way to translate Java without one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** The TeaVM release the build is pinned to. */
export const TEAVM_VERSION = "0.14.1";

/** Where Maven artifacts come from. */
const MAVEN = "https://repo1.maven.org/maven2/org/teavm";

/**
 * The transitive closure of `teavm-cli`, every one `org.teavm:*:<version>` — so
 * they share the pinned version and nothing else has to be resolved. The whole
 * set is the classpath TeaVM both runs on and reads the program from: it reads
 * its own classlib and interop the same way it reads the application's classes,
 * so a jar missing from what it is handed is a class it cannot find.
 */
const ARTIFACTS = [
  "teavm-c-incremental",
  "teavm-classlib",
  "teavm-cli",
  "teavm-core",
  "teavm-devserver",
  "teavm-interop",
  "teavm-jso",
  "teavm-jso-apis",
  "teavm-jso-impl",
  "teavm-metaprogramming-api",
  "teavm-metaprogramming-impl",
  "teavm-platform",
  "teavm-relocated-libs-asm",
  "teavm-relocated-libs-asm-analysis",
  "teavm-relocated-libs-asm-commons",
  "teavm-relocated-libs-asm-tree",
  "teavm-relocated-libs-asm-util",
  "teavm-relocated-libs-commons-cli",
  "teavm-relocated-libs-commons-io",
  "teavm-relocated-libs-hppc",
  "teavm-relocated-libs-rhino",
  "teavm-tooling",
];

/** The runner inside `teavm-cli`. */
const RUNNER = "org.teavm.cli.TeaVMRunner";

/** Where the cached jars live: `~/.mosaic/teavm/<version>/lib`. */
export function cacheDir() {
  return path.join(os.homedir(), ".mosaic", "teavm", TEAVM_VERSION);
}

/**
 * The jars, fetched into the cache if they are not there already.
 *
 * Each is downloaded to a temporary name and moved into place, so a download cut
 * off partway does not leave a half a jar behind that the next run would trust.
 *
 * @param {(msg: string) => void} [log]
 * @returns {Promise<string[]>} the jar paths, the classpath TeaVM needs.
 */
export async function ensureTeaVM(log = () => {}) {
  const lib = path.join(cacheDir(), "lib");
  fs.mkdirSync(lib, { recursive: true });

  const missing = ARTIFACTS.filter(
    (a) => !fs.existsSync(path.join(lib, `${a}.jar`)),
  );
  if (missing.length > 0) {
    log(
      `==> fetching TeaVM ${TEAVM_VERSION} (${missing.length} jar${missing.length === 1 ? "" : "s"})`,
    );
    await Promise.all(missing.map((a) => download(a, lib)));
  }

  return ARTIFACTS.map((a) => path.join(lib, `${a}.jar`));
}

async function download(artifact, lib) {
  const url = `${MAVEN}/${artifact}/${TEAVM_VERSION}/${artifact}-${TEAVM_VERSION}.jar`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`could not fetch ${artifact} from ${url}: ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tmp = path.join(lib, `.${artifact}.${process.pid}.part`);
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, path.join(lib, `${artifact}.jar`));
}

/**
 * Compile a directory of shared `.java` into one JavaScript module.
 *
 * @param {object} opts
 * @param {string[]} opts.sharedDirs  the directories of `.java` to compile.
 * @param {string} opts.outFile    where to write the module.
 * @param {string[]} opts.classpath  the TeaVM jars, from {@link ensureTeaVM}.
 * @param {string[]} [opts.libs]   dependency jars the shared code imports, from
 *                                 the surrounding project's resolved classpath.
 * @param {boolean} [opts.sourcemap]
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ entry: string, classes: number, packages: Record<string, string[]> }}
 *   what it compiled, and the exported classes grouped by their Java package —
 *   `{ "units": ["Units"] }` — which is what lets a page import them by package.
 */
export function compileShared(opts) {
  const { sharedDirs, outFile, classpath, sourcemap = false, log = () => {} } = opts;

  // The `.java` across every shared directory, compiled together as one program
  // — so a class in one tree may reach one in another, and their exports land in
  // a single module grouped by package.
  const sources = sharedDirs.flatMap((dir) => javaSources(dir));
  if (sources.length === 0) {
    throw new Error(`shared: no .java files under ${sharedDirs.join(", ")}`);
  }

  // The libraries the shared code depends on, joining both classpaths — javac's,
  // to resolve the imports, and TeaVM's, to translate whatever of them the code
  // reaches. Two sources: any `.jar` dropped under a shared tree, picked up by
  // being there, and the dependencies the surrounding JVM project resolves
  // (`opts.libs`, from jvmdeps). What they hold still has to be TeaVM-translatable;
  // a jar is not a way around that.
  const jars = [...sharedDirs.flatMap((dir) => jarsUnder(dir)), ...(opts.libs ?? [])];

  // TeaVM is whole-program and slow, so its output is cached against everything
  // that decides it — the sources' mtimes, the dependency jars, the TeaVM
  // version, and whether a source map was asked for. While none of those move,
  // a rebuild (a watch especially) reuses the last module instead of running
  // javac and TeaVM again. This is the only fast path there is: TeaVM tree-shakes
  // one module from a single entry, so there is no recompiling just the files
  // that changed — but there is skipping the whole compile when nothing did.
  const key = cacheKey(sources, jars, sourcemap);
  const cached = readCompileCache(key, outFile);
  if (cached) {
    log("==> shared unchanged, reusing compiled module");
    return {
      entry: cached.entry,
      classes: cached.classes,
      packages: exportsByPackage(outFile, sources),
    };
  }

  requireJdk();

  const cp = [...classpath, ...jars].join(path.delimiter);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-teavm-"));
  const classes = path.join(work, "classes");
  fs.mkdirSync(classes, { recursive: true });

  try {
    // TeaVM compiles from an entry point and tree-shakes from there, so an
    // exported class nothing reaches is not in the output. Rather than make the
    // shared code carry a `main` to hold its exports up, the entry is generated
    // here: a class that names every `@JSExport` type, which is all it takes to
    // keep them — and their exported members — in the build.
    const entry = "MosaicSharedEntry";
    const entryFile = path.join(work, `${entry}.java`);
    fs.writeFileSync(entryFile, generateEntry(entry, exportedClasses(sources)));

    // Bytecode first: TeaVM reads `.class`, not `.java`. The shared code is
    // compiled against the TeaVM jars, which is where `@JSExport` and the rest
    // of the interop annotations come from.
    run(
      "javac",
      ["-cp", cp, "-d", classes, ...sources, entryFile],
      "compile the shared Java",
    );

    const outDir = path.dirname(outFile);
    fs.mkdirSync(outDir, { recursive: true });

    // The program classpath is passed one entry at a time: TeaVM's `-p` takes a
    // single path per flag, and everything the program links against — the
    // compiled classes, every TeaVM jar, and any jar dropped under the shared
    // tree — has to be on it, since that is the one source it reads translated
    // classes from.
    const program = [classes, ...classpath, ...jars].flatMap((p) => ["-p", p]);
    const args = [
      "-cp",
      cp,
      RUNNER,
      ...program,
      "-t",
      "js",
      "--js-module-type",
      "es2015",
      "-d",
      outDir,
      "-f",
      path.basename(outFile),
      ...(sourcemap ? ["-G"] : []),
      entry,
    ];
    const out = run("java", args, "translate the shared Java to JavaScript");

    // TeaVM reports missing classes and the like without a non-zero exit, so
    // the output is read for the line it prints when it could not finish.
    if (/built with errors/i.test(out) || !fs.existsSync(outFile)) {
      const errors = out
        .split("\n")
        .filter((line) => /error/i.test(line))
        .join("\n    ");
      throw new Error(
        `TeaVM could not compile the shared code:\n    ${errors || out.trim()}`,
      );
    }

    const compiled = /Methods compiled:\s*(\d+)/.exec(out);
    const methods = Number(compiled?.[1] ?? 0);
    writeCompileCache(key, outFile, { entry, classes: methods });
    return {
      entry,
      classes: methods,
      packages: exportsByPackage(outFile, sources),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- compile cache -------------------------------------------------------
// TeaVM's output, cached in a stable place — a build stages into a fresh output
// directory each time, so the module cannot be kept there between runs. It is
// keyed by a hash of what decides the output, and holds the emitted module (and
// its source map, when there is one) beside the small facts the return needs
// that cannot be read back from the module — the entry name and method count.

/** Where compiled shared modules are cached: `~/.mosaic/sharedcache/<key>`. */
function cacheDirFor(key) {
  return path.join(os.homedir(), ".mosaic", "sharedcache", key);
}

/**
 * A key over everything that decides the compiled output: each source's path
 * and mtime, the dependency jars, the TeaVM version, and the source-map flag.
 * Any of them moving is a cache miss, which is a full recompile.
 */
function cacheKey(sources, jars, sourcemap) {
  const parts = [
    `teavm:${TEAVM_VERSION}`,
    `sourcemap:${sourcemap ? 1 : 0}`,
    ...sources.map((f) => `src:${f}:${statMtime(f)}`).sort(),
    ...jars.map((f) => `jar:${f}:${statMtime(f)}`).sort(),
  ];
  return hash(parts.join("|"));
}

/**
 * The cached module, copied into place at `outFile` on a hit; `null` on a miss.
 * The source map beside the module (`<name>.map`) comes along when it is there.
 */
function readCompileCache(key, outFile) {
  try {
    const dir = cacheDirFor(key);
    const module = path.join(dir, "shared.js");
    const metaFile = path.join(dir, "meta.json");
    if (!fs.existsSync(module) || !fs.existsSync(metaFile)) return null;
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.copyFileSync(module, outFile);
    const map = path.join(dir, "shared.js.map");
    if (fs.existsSync(map)) fs.copyFileSync(map, `${outFile}.map`);
    return meta;
  } catch {
    return null;
  }
}

/** Save the freshly compiled module and its facts under `key`, best-effort. */
function writeCompileCache(key, outFile, meta) {
  try {
    const dir = cacheDirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(outFile, path.join(dir, "shared.js"));
    const map = `${outFile}.map`;
    if (fs.existsSync(map)) fs.copyFileSync(map, path.join(dir, "shared.js.map"));
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  } catch {
    // A cache that cannot be written is a slower next build, not a failed one.
  }
}

/** A file's mtime in milliseconds, or 0 if it cannot be read. */
function statMtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** A small stable hash of `text`, hex — the same scheme jvmdeps caches by. */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * The exported classes, grouped by the Java package they were declared in.
 *
 * TeaVM writes one module whose exports are keyed by the plain class name —
 * `export { … as Units }` — with no trace of the package. The package is read
 * back from the sources here, so a page can import a class by the package it
 * belongs to rather than from one flat heap of everything the shared tree holds.
 *
 * `main` is the entry point, not something a page calls, so it is left out.
 */
function exportsByPackage(moduleFile, sources) {
  const exported = readExports(moduleFile);
  const packageOf = classPackages(sources);

  const groups = {};
  for (const name of exported) {
    if (name === "main") continue;
    const pkg = packageOf[name] ?? "";
    (groups[pkg] ??= []).push(name);
  }
  for (const pkg in groups) groups[pkg].sort();
  return groups;
}

/** The names an ES module exports: the alias of each `export { orig as alias }` entry. */
function readExports(moduleFile) {
  const text = fs.readFileSync(moduleFile, "utf8");
  const names = new Set();
  for (const block of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of block[1].split(",")) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * A map from each class's plain name to the package it is in, read from the
 * sources — `{ Units: "units" }`. Enough for exported classes, whose names TeaVM
 * keeps unique across the whole output.
 */
function classPackages(sources) {
  const map = {};
  for (const file of sources) {
    const src = fs.readFileSync(file, "utf8");
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1] ?? "";
    for (const m of src.matchAll(
      /\b(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum)\s+(\w+)/g,
    )) {
      map[m[1]] = pkg;
    }
  }
  return map;
}

/** Every `.java` under `dir`, recursively. */
function javaSources(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) javaSources(full, out);
    else if (name.endsWith(".java")) out.push(full);
  }
  return out;
}

/** Every `.jar` under `dir`, recursively — the dependencies picked up by being there. */
function jarsUnder(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) jarsUnder(full, out);
    else if (name.endsWith(".jar")) out.push(full);
  }
  return out;
}

/**
 * The generated entry: a `main` that names each exported type so TeaVM keeps it.
 *
 * A `Class<?>` reference is enough — it roots the type, and rooting the type is
 * what pulls its `@JSExport` members into the build. The array is looked at so
 * the reference is not optimised away before TeaVM has seen it.
 */
function generateEntry(name, classes) {
  const refs = classes.map((fqn) => `${fqn}.class`).join(", ");
  return (
    `// Generated by mosaic. The shared code needs no entry point of its own; this\n` +
    `// one names its @JSExport types so TeaVM, which tree-shakes from main, keeps them.\n` +
    `public final class ${name} {\n` +
    `    public static void main(String[] args) {\n` +
    `        Class<?>[] keep = { ${refs} };\n` +
    `        if (keep.length < 0) throw new RuntimeException();\n` +
    `    }\n` +
    `}\n`
  );
}

/**
 * The public types whose source declares `@JSExport` anywhere — the classes that
 * cross into JavaScript, which the generated entry has to name. Public because a
 * class the entry could not see is one it could not reference; `@JSExport` needs
 * a public class regardless.
 */
function exportedClasses(sources) {
  const found = [];
  for (const file of sources) {
    const src = fs.readFileSync(file, "utf8");
    if (!/@JSExport\b/.test(src)) continue;
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1] ?? "";
    for (const m of src.matchAll(
      /\bpublic\s+(?:final\s+|abstract\s+)*(?:class|interface|enum)\s+(\w+)/g,
    )) {
      found.push(pkg ? `${pkg}.${m[1]}` : m[1]);
    }
  }
  return found;
}

/** `java`/`javac` have to be on the PATH; there is no translating Java without them. */
function requireJdk() {
  for (const tool of ["java", "javac"]) {
    const probe = spawnSync(tool, ["-version"], { encoding: "utf8" });
    if (probe.error) {
      throw new Error(
        `shared: \`${tool}\` is not on the PATH. TeaVM needs a JDK to compile ` +
          `the shared Java — install one, or drop the "shared" key from info.json.`,
      );
    }
  }
}

/** Run a tool, returning its combined output; throw with it on failure. */
function run(tool, args, what) {
  const result = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.error) {
    throw new Error(`could not run \`${tool}\` to ${what}: ${result.error.message}`);
  }
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`\`${tool}\` failed to ${what}:\n    ${out.trim()}`);
  }
  return out;
}
