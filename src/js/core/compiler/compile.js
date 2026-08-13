// Compiling one source file, and finding where its output belongs.
//
// Two source kinds:
//   `.mib`   markup + scoped `<style>`, compiled to a component function.
//   `.js` / `.jsx`
//           JavaScript whose JSX (typically a `Component` subclass's `draw()`)
//           is rewritten into `h()` calls.

import * as fs from "node:fs";
import * as path from "node:path";

import {generate} from "./codegen.js";
import {ensureRuntimeNames, inlineCssImports, inlineSvgImports, transform,} from "./jsx.js";
import {MARKUP_EXT, scopeClass, takeLineMarkers} from "./js.js";
import {parse} from "./parser.js";
import * as sourcemap from "./sourcemap.js";

/** The stem of an application's bootstrap: `main.js` beside `main.mib`. */
const ENTRY_STEM = "main";

/**
 * Compile `file` and write the result under `outdir`, mirroring its position
 * beneath `root`. Returns the destination path.
 *
 * @param opts { root, outdir, runtime, name, sourcemap, components, icons }
 *             `icons` are the directories an `import X from "svg:name"` is
 *             looked up in, nearest first.
 *             `components` maps a component name to `{dest, specifier}` — where
 *             Button actually landed, and the name its package publishes it
 *             under if it has one — so a `<Button/>` tag imports the right one.
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
        path.extname(file) === MARKUP_EXT
            ? compileIb(src, runtime, stem, dest, opts, file)
            : compileJs(src, file, stem, runtime, opts);

    // Line markers travel with the generated code and come out here, becoming
    // the source map's line table.
    const [code, mappings] = takeLineMarkers(js);

    fs.mkdirSync(path.dirname(dest), {recursive: true});
    if (opts.sourcemap === false) {
        fs.writeFileSync(dest, code);
    } else {
        const mapName = path.basename(dest) + ".map";
        fs.writeFileSync(dest, `${code}//# sourceMappingURL=${mapName}\n`);
        fs.writeFileSync(
            path.join(path.dirname(dest), mapName),
            sourcemap.forModule(
                relativeSpecifier(file, path.dirname(dest)),
                src,
                mappings,
            ),
        );
    }
    return dest;
}

function compileIb(src, runtime, stem, dest, opts, file) {
    const components = opts.components ?? new Map();
    const name = opts.name ?? componentName(stem);
    return generate(parse(src), {
        minify: opts.minify,
        runtime,
        name,
        hash: hash(src),
        controller: controllerFor(name, file, dest),
        resolve: (name) => {
            const target = components.get(name);
            if (!target) {
                throw new Error(
                    `<${name}/> has no compiled module — nothing under the inputs compiles to ${name}`,
                );
            }
            // A component from a tree that is published under a name is imported
            // by that name and its own path within it —
            // `mosaic/frameworks/ui/controls/button/Button.js`. That survives the
            // importing module moving and reaches the same one copy whichever
            // application is being built, and it brings in Button alone: the
            // framework's index names every component the framework has, so
            // importing through it would carry the lot of them.
            if (target.specifier) return target.specifier;
            return relativeSpecifier(target.dest, path.dirname(dest));
        },
    });
}

/**
 * The controller written beside a page: `Foo.mib` is paired with a
 * `FooController.js` next to it, if there is one — that is the whole of the
 * arrangement, and a page with no such file has no controller of its own.
 *
 * The specifier is written to where the *compiled* page lands, since that is
 * what will do the importing.
 *
 * @returns {string|null} What the compiled page should import, or null.
 */
function controllerFor(name, file, dest) {
    if (!file) return null;
    for (const ext of [".js", ".jsx"]) {
        const source = path.join(path.dirname(file), `${name}Controller${ext}`);
        if (!fs.existsSync(source)) continue;
        // Where that source itself compiles to, so the two sit as they do now.
        const compiled = path.join(path.dirname(dest), `${name}Controller.js`);
        return relativeSpecifier(compiled, path.dirname(dest));
    }
    return null;
}

function compileJs(src, file, stem, runtime, opts = {}) {
    // Drawn views are scoped like .mib components: one class per module, carried
    // by its elements and required by its stylesheet's selectors.
    const scope = scopeClass(hash(src));
    let code = transform(src, scope);
    const [withCss, hasCss] = inlineCssImports(code, path.dirname(file), scope, {
        minify: opts.minify,
    });
    // An icon is markup, and becomes the component that draws it — so `h` is
    // needed for an icon just as it is for anything else drawn here.
    const [inlined] = inlineSvgImports(withCss, opts.icons ?? [], scope);

    const needed = ["h", "Fragment"];
    if (hasCss) needed.push("addStyles");
    return ensurePage(
        ensureRuntimeNames(inlined, runtime, needed),
        file,
        stem,
        runtime,
    );
}

/**
 * Bind the module's own page, if it has one.
 *
 * A `main.js` beside a `main.mib` is that page's module: the markup is compiled
 * and the binding is put in scope here, so nothing has to import a file it
 * never wrote. `main.mib` gives `Main`, the name it exports.
 *
 * A module that imports the page itself keeps its own import — saying so
 * explicitly is never wrong.
 */
function ensurePage(code, file, stem, runtime) {
    const markup = path.join(path.dirname(file), `${stem}${MARKUP_EXT}`);
    if (!fs.existsSync(markup)) return code;

    const name = componentName(stem);
    const specifier = `./${stem}${MARKUP_EXT}.js`;

    const header = [];
    if (!code.includes(specifier)) {
        header.push(`import ${name} from ${JSON.stringify(specifier)};`);
    }

    // `main.js` beside `main.mib` is the application entry, so its page is the
    // application's. Registering it here is what lets `new MosaicApplication()`
    // find it with nothing named and nothing fetched — and it has to run before
    // the module's own code does, which is why it goes at the top. Any other
    // pair is just a component and its markup.
    const isEntry = stem === ENTRY_STEM;
    if (isEntry) header.push(`MosaicApplication.registerPage(${name});`);

    const out = header.length > 0 ? `${header.join("\n")}\n${code}` : code;
    return isEntry
        ? ensureRuntimeNames(out, runtime, ["MosaicApplication"])
        : out;
}

/**
 * Where a source compiles to: under `outdir`, mirroring the input tree so
 * `components/button/Button.js` keeps its folder.
 *
 * An `.mib` file keeps its whole name and gains `.js` — `main.mib` compiles to
 * `main.mib.js` — so a page can sit beside a `main.js` of its own that imports
 * it. A `.js`/`.jsx` source keeps its own name; it is already a module.
 */
export function destination(file, opts) {
    if (opts.out) return opts.out;
    const stem = path.basename(file, path.extname(file));
    const name = path.extname(file) === MARKUP_EXT ? path.basename(file) : stem;
    const relative = path.relative(opts.root, path.dirname(file));
    const inside = relative.startsWith("..") ? "" : relative;
    return path.join(opts.outdir, inside, `${name}.js`);
}

/** Every compilable source under `dir`, including subdirectories. */
export function collectSources(dir, out = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectSources(full, out);
        else if ([MARKUP_EXT, ".jsx", ".js"].includes(path.extname(full)))
            out.push(full);
    }
    return out.sort();
}

/** A specifier that names a package rather than a path. */
export function isBare(specifier) {
    return !specifier.startsWith(".") && !specifier.startsWith("/");
}

/**
 * The specifier a file in `from` should use to import `target`, e.g.
 * `../../src/js/core/runtime/mosaic.js`. Both are resolved against the working
 * directory, so `--runtime src/js/core/runtime/mosaic.js` is correct for every
 * output file no matter how deeply it is nested.
 */
export function relativeSpecifier(target, from) {
    let spec = path
        .relative(path.resolve(from), path.resolve(target))
        .split(path.sep)
        .join("/");
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

/**
 * FNV-1a, rendered base36 — stable per source, short enough for a class name.
 *
 * The first character is always a letter. The hash *is* the scope class, and
 * `.7abcdef` is not a selector: a class may begin with a digit in the markup,
 * but naming one in CSS then takes an escape. Starting with a letter keeps the
 * stylesheet readable and the rule valid.
 */
export function hash(src) {
    let h = 0xcbf29ce484222325n;
    const bytes = new TextEncoder().encode(src);
    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }

    const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let out = "";
    let n = h;
    while (out.length < 6) {
        out = digits[Number(n % 36n)] + out;
        n /= 36n;
    }
    return letters[Number(n % 26n)] + out;
}
