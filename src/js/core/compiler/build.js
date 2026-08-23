// Compiling a set of source trees in one pass.
//
// Doing them together is what lets a `<Button/>` in one tree resolve to a
// module compiled into another: every destination is known before anything is
// written.

import * as fs from "node:fs";
import * as path from "node:path";

import {
  collectSources,
  compileFile,
  componentName,
  destination,
} from "./compile.js";
import { stemOf } from "./js.js";

/**
 * Expand `sources` — `[{ input, outdir, specifier }]`, where `input` is a file
 * or a directory and `specifier` is what the tree is imported as, if it is
 * published under a name — into one job per compilable file.
 *
 * A tree's own output directory is skipped: an application's build lands
 * inside it, and compiling the previous run's output would be nonsense. So is
 * anything named in `skip` — a build is written into a staging directory and
 * moved into place afterwards, so the directory it will land in is not among
 * the outputs of this run and has to be said separately. Without that, the
 * previous build sitting there is walked as though it were source.
 */
export function planJobs(sources, skip = []) {
  const outdirs = [...sources.map((s) => s.outdir), ...skip].map((d) =>
    path.resolve(d),
  );
  const isOutput = (file) => {
    const full = path.resolve(file);
    return outdirs.some(
      (dir) => full === dir || full.startsWith(dir + path.sep),
    );
  };

  const jobs = [];
  for (const { input, outdir, specifier } of sources) {
    if (!fs.existsSync(input)) throw new Error(`no such input: ${input}`);
    if (fs.statSync(input).isDirectory()) {
      for (const file of collectSources(input)) {
        if (!isOutput(file))
          jobs.push({ file, root: input, outdir, specifier });
      }
    } else {
      jobs.push({ file: input, root: path.dirname(input), outdir, specifier });
    }
  }
  return jobs;
}

/**
 * Compile every source in `sources`.
 *
 * @param opts { runtime, name, sourcemap, minify, icons, out, onFile, skip }
 *             `skip` names directories that are output rather than source,
 *             beyond the ones the sources themselves write to.
 * @returns the destination path of each compiled file
 */
export function compileAll(sources, opts = {}) {
  const jobs = planJobs(sources, opts.skip ?? []);
  if (jobs.length === 0) return [];

  const options = (job) => ({
    root: job.root,
    outdir: job.outdir,
    out: jobs.length === 1 ? (opts.out ?? null) : null,
    runtime: opts.runtime,
    name: opts.name ?? null,
    sourcemap: opts.sourcemap,
    minify: opts.minify,
    icons: opts.icons ?? [],
  });

  // Destinations are known before anything is written, so a `<Button/>` in one
  // tree can be resolved to a module compiled into another.
  //
  // A name can be claimed more than once — two demos may each have their own
  // Counter — so every candidate is kept and the choice is made per module.
  // What class each component draws its root with, so a stylesheet can name
  // the component — `.mydialog ComboBox` — and have the class put in its
  // place. Read off the source rather than imported: the compiler never runs
  // the modules it compiles.
  const styleNames = new Map();
  for (const job of jobs) {
    const name = componentName(stemOf(job.file));
    const declared = declaredStyleName(job.file);
    if (declared) styleNames.set(name, declared);
  }

  const byName = new Map();
  for (const job of jobs) {
    const name = opts.name ?? componentName(stemOf(job.file));
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({
      dest: destination(job.file, options(job)),
      outdir: job.outdir,
      // A tree that is published under a name — a framework — is imported by
      // that name. Its modules move with the package they ship in, so a path
      // from wherever the importer happens to sit would be the wrong thing to
      // write down.
      specifier: job.specifier,
    });
  }

  /**
   * The modules `job` should resolve its component tags against: a component
   * in its own tree wins over one of the same name elsewhere, so a demo uses
   * its own Counter rather than whichever was compiled first.
   *
   * A component from a published tree is named by its own module rather than
   * by the framework's index. Naming `<Button/>` in markup is what asks for
   * Button, and it should bring in Button — the index names every component
   * the framework has, and importing through it would carry them all.
   */
  const componentsFor = (job) => {
    const map = new Map();

    for (const [name, candidates] of byName) {
      const own = candidates.find((c) => c.outdir === job.outdir);
      const chosen = own ?? candidates[0];

      // Inside the tree it ships in, a framework component is just a
      // module beside its neighbours: the package cannot import itself by
      // name.
      const published =
        chosen.outdir !== job.outdir && chosen.specifier
          ? `${chosen.specifier}/${path
              .relative(chosen.outdir, chosen.dest)
              .split(path.sep)
              .join("/")}`
          : null;

      map.set(name, { dest: chosen.dest, specifier: published });
    }
    return map;
  };

  // Two outputs differing only by case are the same file to a case-insensitive
  // filesystem — and to Bun's resolver even on Linux, which would silently
  // resolve one module's import to the other.
  const byFold = new Map();
  for (const job of jobs) {
    const dest = destination(job.file, options(job));
    const fold = dest.toLowerCase();
    const first = byFold.get(fold);
    if (first && first !== dest) {
      throw new Error(
        `${job.file} compiles to ${dest}, which differs from ${first} only by case — ` +
          `rename one of the sources`,
      );
    }
    byFold.set(fold, dest);
  }

  const written = [];
  for (const job of jobs) {
    let dest;
    try {
      dest = compileFile(job.file, {
        ...options(job),
        components: componentsFor(job),
        styleNames,
      });
    } catch (e) {
      throw new Error(`${job.file}: ${e.message}`, { cause: e });
    }
    written.push(dest);
    opts.onFile?.(job.file, dest);
  }
  return written;
}

/**
 * The class a component declares as its own — `static styleName = "v-Dialog"`.
 *
 * Read out of the source with a pattern rather than by importing the module:
 * the compiler compiles, it does not run what it compiles, and a component
 * that had to be executed to be compiled could not be compiled at all.
 *
 * @returns {string|null} what it declared, or null for a component that
 *   declares none — one drawn as a kind of another inherits that one's, and
 *   the runtime is where that is resolved.
 */
function declaredStyleName(file) {
  if (![".js", ".jsx"].includes(path.extname(file))) return null;
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const match = /static\s+styleName\s*=\s*["']([^"']+)["']/.exec(source);
  return match ? match[1] : null;
}
