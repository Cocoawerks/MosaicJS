// Dependency resolution for shared code: the jars a `shared/` tree imports from
// Maven or Gradle, found by asking the surrounding JVM project's own build for
// its classpath.
//
// The reason it is done this way and not by reading the imports: an import names
// a class, not a jar or a version, and the class its code reaches in turn pulls
// in that jar's own dependencies. The project's build already knows all of that —
// the versions it pins and the whole transitive closure — because it is what put
// the jars in `.m2`/`.gradle` in the first place. So mosaic asks it, rather than
// guessing from the cache.
//
// Nothing to ask is not an error. Shared code that leans on no libraries sits in
// no project, or in one this cannot read, and gets an empty classpath — the same
// as before this existed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The dependency jars available to the JVM project `fromDir` sits in.
 *
 * @param {string} fromDir  where to start looking — the shared directory.
 * @param {(msg: string) => void} [log]
 * @returns {string[]} absolute jar paths, empty when there is no project.
 */
export function projectClasspath(fromDir, log = () => {}) {
  const project = findProject(fromDir);
  if (!project) return [];

  const cached = readCache(project);
  if (cached) return cached;

  log(`==> resolving shared dependencies (${project.tool})`);
  const jars =
    project.tool === "gradle"
      ? gradleClasspath(project)
      : mavenClasspath(project);

  writeCache(project, jars);
  return jars;
}

/**
 * The nearest JVM project at or above `dir`: the first Gradle or Maven build
 * walking up. Gradle wins where both are present — a Gradle build is the one
 * with a wrapper to invoke.
 *
 * @returns {{ tool: "gradle"|"maven", root: string, launcher: string, buildFiles: string[] }|null}
 */
function findProject(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    const gradle = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]
      .map((f) => path.join(cur, f))
      .filter((f) => fs.existsSync(f));
    if (gradle.length > 0) {
      const wrapper = path.join(cur, process.platform === "win32" ? "gradlew.bat" : "gradlew");
      return {
        tool: "gradle",
        root: cur,
        launcher: fs.existsSync(wrapper) ? wrapper : "gradle",
        buildFiles: gradle,
      };
    }
    const pom = path.join(cur, "pom.xml");
    if (fs.existsSync(pom)) {
      const wrapper = path.join(cur, process.platform === "win32" ? "mvnw.cmd" : "mvnw");
      return {
        tool: "maven",
        root: cur,
        launcher: fs.existsSync(wrapper) ? wrapper : "mvn",
        buildFiles: [pom],
      };
    }
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/**
 * Gradle's resolved classpath: a task registered on every project through an
 * init script prints the files of its compile and runtime classpaths, and the
 * jars are gathered from what it prints. Registering on all projects covers the
 * subproject the shared code sits in without having to know which one that is.
 */
function gradleClasspath(project) {
  const init = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-gradle-")),
    "mosaic-classpath.gradle",
  );
  fs.writeFileSync(
    init,
    `allprojects { proj ->\n` +
      `  proj.tasks.register("mosaicPrintClasspath") {\n` +
      `    doLast {\n` +
      `      ["compileClasspath", "runtimeClasspath"].each { name ->\n` +
      `        def cfg = proj.configurations.findByName(name)\n` +
      `        if (cfg != null && cfg.canBeResolved) {\n` +
      `          try { cfg.files.each { f -> println "MOSAICJAR:" + f.absolutePath } }\n` +
      `          catch (Exception ignored) {}\n` +
      `        }\n` +
      `      }\n` +
      `    }\n` +
      `  }\n` +
      `}\n`,
  );

  try {
    const out = run(
      project.launcher,
      ["-q", "--console=plain", "--init-script", init, "mosaicPrintClasspath"],
      project.root,
      "resolve the Gradle classpath",
    );
    return jarsFrom(out.split("\n").flatMap((line) =>
      line.startsWith("MOSAICJAR:") ? [line.slice("MOSAICJAR:".length).trim()] : [],
    ));
  } finally {
    fs.rmSync(path.dirname(init), { recursive: true, force: true });
  }
}

/** Maven's resolved classpath, written to a file by the dependency plugin and read back. */
function mavenClasspath(project) {
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-maven-")),
    "cp.txt",
  );
  try {
    run(
      project.launcher,
      [
        "-q",
        "-f",
        path.join(project.root, "pom.xml"),
        "dependency:build-classpath",
        `-Dmdep.outputFile=${out}`,
        "-DincludeScope=compile",
      ],
      project.root,
      "resolve the Maven classpath",
    );
    const text = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    return jarsFrom(text.split(path.delimiter).map((s) => s.trim()));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}

/** The `.jar` paths among `entries` that exist, deduplicated. */
function jarsFrom(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (entry.endsWith(".jar") && fs.existsSync(entry)) seen.add(entry);
  }
  return [...seen];
}

/** Run a build tool, returning stdout; throw with its output on failure. */
function run(launcher, args, cwd, what) {
  const result = spawnSync(launcher, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (result.error) {
    throw new Error(
      `could not run \`${path.basename(launcher)}\` to ${what}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `\`${path.basename(launcher)}\` failed to ${what}:\n    ` +
        `${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout ?? "";
}

// --- caching -------------------------------------------------------------
// Resolving the classpath starts a build tool, which is slow, so the result is
// cached against the build files that decide it: while they are untouched the
// classpath is too, and a rebuild — a watch especially — reuses it.

function cacheFile(project) {
  const key = `${project.root}|${project.buildFiles
    .map((f) => `${f}:${statMtime(f)}`)
    .sort()
    .join("|")}`;
  return path.join(os.homedir(), ".mosaic", "depcache", `${hash(key)}.json`);
}

function readCache(project) {
  try {
    const file = cacheFile(project);
    if (!fs.existsSync(file)) return null;
    const jars = JSON.parse(fs.readFileSync(file, "utf8"));
    // A cached jar deleted from the local repo since is no longer usable.
    return Array.isArray(jars) && jars.every((j) => fs.existsSync(j)) ? jars : null;
  } catch {
    return null;
  }
}

function writeCache(project, jars) {
  try {
    const file = cacheFile(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(jars));
  } catch {
    // A cache that cannot be written is a slower build, not a failed one.
  }
}

function statMtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
