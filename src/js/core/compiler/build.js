// Compiling a set of source trees in one pass.
//
// Doing them together is what lets a `<Button/>` in one tree resolve to a
// module compiled into another: every destination is known before anything is
// written.

import * as fs from "node:fs";
import * as path from "node:path";

import {collectSources, compileFile, componentName, destination} from "./compile.js";

/**
 * Expand `sources` — `[{ input, outdir, specifier }]`, where `input` is a file
 * or a directory and `specifier` is what the tree is imported as, if it is
 * published under a name — into one job per compilable file.
 *
 * A tree's own output directory is skipped: an application's build lands
 * inside it, and compiling the previous run's output would be nonsense.
 */
export function planJobs(sources) {
  const outdirs = sources.map((s) => path.resolve(s.outdir));
  const isOutput = (file) => {
    const full = path.resolve(file);
    return outdirs.some((dir) => full === dir || full.startsWith(dir + path.sep));
  };

  const jobs = [];
  for (const {input, outdir, specifier} of sources) {
    if (!fs.existsSync(input)) throw new Error(`no such input: ${input}`);
    if (fs.statSync(input).isDirectory()) {
      for (const file of collectSources(input)) {
        if (!isOutput(file)) jobs.push({file, root: input, outdir, specifier});
      }
    } else {
      jobs.push({file: input, root: path.dirname(input), outdir, specifier});
    }
  }
  return jobs;
}

/**
 * Compile every source in `sources`.
 *
 * @param opts { runtime, runtimeExports, name, sourcemap, out, onFile }
 * @returns the destination path of each compiled file
 */
export function compileAll(sources, opts = {}) {
  const jobs = planJobs(sources);
  if (jobs.length === 0) return [];

  const options = (job) => ({
    root: job.root,
    outdir: job.outdir,
    out: jobs.length === 1 ? (opts.out ?? null) : null,
    runtime: opts.runtime,
    runtimeExports: opts.runtimeExports,
    name: opts.name ?? null,
    sourcemap: opts.sourcemap,
  });

  // Destinations are known before anything is written, so a `<Button/>` in one
  // tree can be resolved to a module compiled into another.
  //
  // A name can be claimed more than once — two demos may each have their own
  // Counter — so every candidate is kept and the choice is made per module.
  const byName = new Map();
  for (const job of jobs) {
    const name = opts.name ?? componentName(path.basename(job.file, path.extname(job.file)));
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
   * The modules `job` should resolve its component tags against: a component in
   * its own tree wins over one of the same name elsewhere, so a demo uses its
   * own Counter rather than whichever was compiled first.
   */
  const componentsFor = (job) => {
    const map = new Map();
    for (const [name, candidates] of byName) {
      const own = candidates.find((c) => c.outdir === job.outdir);
      const chosen = own ?? candidates[0];
      // Inside the tree it ships in, a framework component is just a module
      // beside its neighbours: the package cannot import itself by name.
      map.set(name, {
        dest: chosen.dest,
        specifier: chosen.outdir === job.outdir ? null : chosen.specifier ?? null,
      });
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
      dest = compileFile(job.file, { ...options(job), components: componentsFor(job) });
    } catch (e) {
      throw new Error(`${job.file}: ${e.message}`, { cause: e });
    }
    written.push(dest);
    opts.onFile?.(job.file, dest);
  }
  return written;
}
