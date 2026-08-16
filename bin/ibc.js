#!/usr/bin/env bun
// ibc — the MosaicJS compiler. Turns components into imperative JavaScript
// that builds the DOM through a `h()` runtime.
//
// Bundling is Bun's job: compile to `--outdir`, then point `bun build` at the
// entry module. See dev.sh.

import { compileAll } from "../src/js/core/compiler/build.js";

const USAGE = `usage: ibc --outdir dir <input.mib|input.js|input.jsx|dir>...
           [--outdir dir2 <more inputs>...]
           [-o out.js] [--runtime src/js/core/runtime/mosaic.js]
           [--name Component] [--no-sourcemap] [--quiet]

\`--outdir\` applies to the inputs that follow it, so one run can compile a
component library and an application into separate trees — and still resolve
\`<Button/>\` to wherever Button actually landed.`;

function parseArgs(argv) {
  const args = {
    // [path, outdir] — an input is paired with the --outdir in force when it
    // was named.
    inputs: [],
    out: null,
    runtime: "src/js/core/runtime/mosaic.js",
    name: null,
    sourcemap: true,
    quiet: false,
  };

  let outdir = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (flag) => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`\`${flag}\` needs a value`);
      return v;
    };
    if (a === "-o" || a === "--out") args.out = next(a);
    else if (a === "--outdir") outdir = next(a);
    else if (a === "--runtime") args.runtime = next(a);
    else if (a === "--name") args.name = next(a);
    else if (a === "--no-sourcemap") args.sourcemap = false;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith("-")) throw new Error(`unknown flag \`${a}\``);
    else {
      if (!outdir && !args.out)
        throw new Error("--outdir must come before the inputs it covers");
      args.inputs.push([a, outdir]);
    }
  }

  if (args.inputs.length === 0) throw new Error("missing input path");
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`ibc: ${e.message}\n\n${USAGE}`);
    return 1;
  }

  try {
    compileAll(
      args.inputs.map(([input, outdir]) => ({ input, outdir })),
      {
        runtime: args.runtime,
        name: args.name,
        sourcemap: args.sourcemap,
        out: args.out,
        onFile: args.quiet
          ? undefined
          : (src, dest) => console.log(`${src} -> ${dest}`),
      },
    );
  } catch (e) {
    console.error(`ibc: ${e.message}`);
    return 1;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
