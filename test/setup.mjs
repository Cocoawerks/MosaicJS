// Preloaded before the test suite (see bunfig.toml).
//
// Several suites import the framework as an application actually receives it —
// the compiled modules under an example's `build/` — rather than the source
// tree. That output is gitignored, so a fresh clone has none of it and those
// suites fail to import at all.
//
// Worse than missing is stale: a build left over from before a rename resolves
// fine and fails deep inside a test, which reads as a broken framework rather
// than a broken build. So this rebuilds whenever the source is newer than the
// output, not merely when the output is absent.
//
// `--keep-modules` matters: a plain compile bundles and then prunes the very
// modules these tests import.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "mosaic.js");

/** The examples the tests import compiled output from. */
const EXAMPLES = ["Counter_main", "Counter_component"];

/** Proof a build is there: the runtime the tests import by path. */
const MARKER = path.join("build", "node_modules", "mosaic", "runtime", "mosaic.js");

/**
 * The most recent mtime under `dir`, or 0 if it is not there.
 * @param {string} dir
 * @returns {number}
 */
function newestUnder(dir) {
  let newest = 0;
  /** @param {string} d */
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "build" || e.name === "node_modules") continue;
        walk(full);
      } else {
        const { mtimeMs } = fs.statSync(full);
        if (mtimeMs > newest) newest = mtimeMs;
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * Is `app`'s compiled output present and no older than what it was built from?
 * @param {string} app absolute path to the example
 * @returns {boolean}
 */
function isFresh(app) {
  const marker = path.join(app, MARKER);
  if (!fs.existsSync(marker)) return false;
  const built = fs.statSync(marker).mtimeMs;
  // The framework itself is an input: a change under src/js invalidates every
  // example's build, which is exactly the staleness that is hard to spot.
  return built >= newestUnder(path.join(ROOT, "src", "js")) &&
         built >= newestUnder(path.join(app, "src"));
}

for (const name of EXAMPLES) {
  const app = path.join(ROOT, "examples", name);
  if (!fs.existsSync(app)) continue;
  if (isFresh(app)) continue;

  process.stderr.write(`test setup: compiling examples/${name}\n`);
  const r = spawnSync(
    "bun",
    [CLI, "compile", "--keep-modules", "--quiet", app],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (r.status !== 0) {
    throw new Error(
      `test setup: could not compile examples/${name} — the suites that import ` +
      `its compiled output cannot run. Try \`bun bin/mosaic.js compile ` +
      `--keep-modules examples/${name}\` to see why.`,
    );
  }
}
