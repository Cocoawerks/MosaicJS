// Compiling one source file, and finding where its output belongs.
//
// Two source kinds:
//   `.ib`   markup + scoped `<style>`, compiled to a component function.
//   `.js` / `.jsx`
//           JavaScript whose JSX (typically a `Component` subclass's `draw()`)
//           is rewritten into `h()` calls.

import * as fs from "node:fs";
import * as path from "node:path";

import { generate } from "./codegen.js";
import { ensureRuntimeNames, inlineCssImports, transform } from "./jsx.js";
import { takeLineMarkers } from "./js.js";
import { parse } from "./parser.js";
import * as sourcemap from "./sourcemap.js";

/**
 * Compile `file` and write the result under `outdir`, mirroring its position
 * beneath `root`. Returns the destination path.
 *
 * @param opts { root, outdir, runtime, name, sourcemap, components }
 *             `components` maps a component name to its compiled path, so a
 *             `<Button/>` tag imports wherever Button actually landed.
 */
export function compileFile(file, opts) {
  const src = fs.readFileSync(file, "utf8");
  const stem = path.basename(file, path.extname(file));

  // Where this module will land, so its imports can be written relative to it.
  // A bare specifier like `mosaic` names a package rather than a path, and is
  // emitted as written — the resolver finds it, not the file system layout.
  const dest = destination(file, opts);
  const runtime = isBare(opts.runtime)
    ? opts.runtime
    : relativeSpecifier(opts.runtime, path.dirname(dest));

  const js =
    path.extname(file) === ".ib"
      ? compileIb(src, runtime, stem, dest, opts)
      : compileJs(src, file, stem, runtime);

  // Line markers travel with the generated code and come out here, becoming
  // the source map's line table.
  const [code, mappings] = takeLineMarkers(js);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (opts.sourcemap === false) {
    fs.writeFileSync(dest, code);
  } else {
    const mapName = path.basename(dest) + ".map";
    fs.writeFileSync(dest, `${code}//# sourceMappingURL=${mapName}\n`);
    fs.writeFileSync(
      path.join(path.dirname(dest), mapName),
      sourcemap.forModule(relativeSpecifier(file, path.dirname(dest)), src, mappings),
    );
  }
  return dest;
}

function compileIb(src, runtime, stem, dest, opts) {
  const components = opts.components ?? new Map();
  return generate(parse(src), {
    runtime,
    name: opts.name ?? componentName(stem),
    hash: hash(src),
    resolve: (name) => {
      const target = components.get(name);
      if (!target) {
        throw new Error(
          `<${name}/> has no compiled module — nothing under the inputs compiles to ${name}`,
        );
      }
      return relativeSpecifier(target, path.dirname(dest));
    },
  });
}

function compileJs(src, file, stem, runtime) {
  // Drawn views are scoped like .ib components: one attribute per module,
  // stamped on its elements and required by its stylesheet's selectors.
  const scopeAttr = `data-mosaic-${hash(src)}`;
  let code = transform(src, scopeAttr);
  const [inlined, hasCss] = inlineCssImports(code, path.dirname(file), scopeAttr);

  const needed = ["h", "Fragment"];
  if (hasCss) needed.push("addStyles");
  return ensurePage(ensureRuntimeNames(inlined, runtime, needed), file, stem);
}

/**
 * Bind the module's own page, if it has one.
 *
 * A `main.js` beside a `main.ib` is that page's module: the markup is compiled
 * and the binding is put in scope here, so nothing has to import a file it
 * never wrote. `main.ib` gives `Main`, the name it exports.
 *
 * A module that imports the page itself keeps its own import — saying so
 * explicitly is never wrong.
 */
function ensurePage(code, file, stem) {
  const markup = path.join(path.dirname(file), `${stem}.ib`);
  if (!fs.existsSync(markup)) return code;

  const name = componentName(stem);
  const specifier = `./${stem}.ib.js`;
  if (code.includes(specifier)) return code;

  return `import ${name} from ${JSON.stringify(specifier)};\n${code}`;
}

/**
 * Where a source compiles to: under `outdir`, mirroring the input tree so
 * `components/button/Button.js` keeps its folder.
 *
 * An `.ib` file keeps its whole name and gains `.js` — `main.ib` compiles to
 * `main.ib.js` — so a page can sit beside a `main.js` of its own that imports
 * it. A `.js`/`.jsx` source keeps its own name; it is already a module.
 */
export function destination(file, opts) {
  if (opts.out) return opts.out;
  const stem = path.basename(file, path.extname(file));
  const name = path.extname(file) === ".ib" ? path.basename(file) : stem;
  const relative = path.relative(opts.root, path.dirname(file));
  const inside = relative.startsWith("..") ? "" : relative;
  return path.join(opts.outdir, inside, `${name}.js`);
}

/** Every compilable source under `dir`, including subdirectories. */
export function collectSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, out);
    else if ([".ib", ".jsx", ".js"].includes(path.extname(full))) out.push(full);
  }
  return out.sort();
}

/** A specifier that names a package rather than a path. */
export function isBare(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

/**
 * The specifier a file in `from` should use to import `target`, e.g.
 * `../../src/js/runtime/mosaic.js`. Both are resolved against the working
 * directory, so `--runtime src/js/runtime/mosaic.js` is correct for every
 * output file no matter how deeply it is nested.
 */
export function relativeSpecifier(target, from) {
  let spec = path.relative(path.resolve(from), path.resolve(target)).split(path.sep).join("/");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  return spec;
}

/** `my-widget` / `my_widget` -> `MyWidget`, so the output is a valid identifier. */
export function componentName(stem) {
  let out = "";
  let upper = true;
  for (const c of stem) {
    if (c === "-" || c === "_" || c === " " || c === ".") upper = true;
    else if (upper) {
      out += c.toUpperCase();
      upper = false;
    } else out += c;
  }
  out = [...out].filter((c) => /[\p{L}\p{N}_$]/u.test(c)).join("");
  if (out === "" || /^\d/.test(out)) out = "_" + out;
  return out;
}

/** FNV-1a, rendered base36 — stable per source, short enough for an attribute. */
export function hash(src) {
  let h = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(src);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  let n = h;
  while (out.length < 7) {
    out = digits[Number(n % 36n)] + out;
    n /= 36n;
  }
  return out;
}
