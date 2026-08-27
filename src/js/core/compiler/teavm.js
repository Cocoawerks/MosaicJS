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
 * @param {string} opts.sharedDir  the directory of `.java` to compile.
 * @param {string} opts.outFile    where to write the module.
 * @param {string[]} opts.classpath  the TeaVM jars, from {@link ensureTeaVM}.
 * @param {string} [opts.entry]    the entry class, `geo.Main` — found by name
 *                                 when omitted.
 * @param {boolean} [opts.sourcemap]
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ entry: string, classes: number, packages: Record<string, string[]> }}
 *   what it compiled, and the exported classes grouped by their Java package —
 *   `{ "units": ["Units"] }` — which is what lets a page import them by package.
 */
export function compileShared(opts) {
  const { sharedDir, outFile, classpath, sourcemap = false, log = () => {} } = opts;

  requireJdk();

  const sources = javaSources(sharedDir);
  if (sources.length === 0) {
    throw new Error(`shared: no .java files under ${sharedDir}`);
  }

  const cp = classpath.join(path.delimiter);
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
    // compiled classes and every TeaVM jar — has to be on it, since that is the
    // one source it reads translated classes from.
    const program = [classes, ...classpath].flatMap((p) => ["-p", p]);
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
    return {
      entry,
      classes: Number(compiled?.[1] ?? 0),
      packages: exportsByPackage(outFile, sources),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
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
