// Documentation generator — a small, dependency-free replacement for TypeDoc.
//
// It reads a tree of `.js` files and writes one HTML page for each, plus an
// `index.html` linking them. Every file is taken to be one of three kinds:
//
//   1. a plain JavaScript class,
//   2. a module of JavaScript functions, or
//   3. a Mosaic Component (a class whose ancestry reaches `Component`).
//
// What is documented is what an author marked. Comments are read the JSDoc way
// — a `/** … */` block above a declaration — and visibility is opt-in:
//
//   @public      documented; anyone may use it.
//   @protected   documented; only a subclass may use it. Applies to a class's
//                own instance variables and methods.
//
// A standalone function is either `@public` or wholly private. Anything without
// a visibility tag is private and left out. A directory named `private` is
// skipped whole.
//
// A Component additionally lists the props its `static props` declares, its
// superclasses' included; a class shows its ancestry, linking any ancestor that
// is documented here too.
import * as fs from "node:fs";
import * as path from "node:path";

/** The subfolder every page is written into; only `index.html` sits above it. */
const PAGES_DIR = "pages";

/**
 * Document every `.js` file under `inputDir` into `outDir`.
 *
 * @param {string} inputDir The tree to read.
 * @param {string} outDir Where the HTML is written (created if need be).
 * @param {object} [options]
 * @param {string} [options.title] The index heading. Defaults to the input
 *   folder's name followed by " Documentation".
 * @returns {{count: number, index: string}}
 */
export function generateDocs(inputDir, outDir, options = {}) {
  const title =
    options.title || `${path.basename(path.resolve(inputDir))} Documentation`;
  const files = collectFiles(inputDir);
  const modules = files.map((file) => parseModule(file, inputDir));
  const byName = new Map(
    modules.filter((m) => m.className).map((m) => [m.className, m]),
  );
  for (const m of modules) resolve(m, byName);

  fs.rmSync(outDir, { recursive: true, force: true });
  const pagesDir = path.join(outDir, PAGES_DIR);
  fs.mkdirSync(pagesDir, { recursive: true });
  for (const m of modules) {
    fs.writeFileSync(path.join(pagesDir, m.htmlName), renderPage(m, byName));
  }
  // `index.html` sits alone at the top level; every page lives one folder down,
  // so the index links into `PAGES_DIR/` and a page links back up with `../`.
  const index = path.join(outDir, "index.html");
  fs.writeFileSync(index, renderIndex(modules, title));
  return { count: modules.length, index };
}

// --- reading the tree -------------------------------------------------------

/** Every `.js` file under `dir`, skipping any directory named `private`. */
function collectFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "private") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

// --- parsing one module -----------------------------------------------------

/**
 * Read one file into a model the renderer draws from.
 *
 * The parse is deliberately shallow: it finds `/** … *\/` blocks and looks at
 * the declaration on the line beneath each, which is enough for the mosaic
 * source it documents and needs no JavaScript parser.
 */
function parseModule(file, inputDir) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(inputDir, file).split(path.sep).join("/");
  const htmlName = rel.replace(/\.js$/, "").replace(/[/]/g, ".") + ".html";

  const model = {
    file,
    rel,
    htmlName,
    kind: "functions",
    title: path.basename(file),
    description: "",
    className: null,
    superName: null,
    ownProps: [],
    allProps: [],
    properties: [],
    methods: [],
    functions: [],
    ancestry: [],
    isComponent: false,
  };

  const header = topComment(src);
  const cls = /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.]+))?/.exec(
    src,
  );

  const blocks = docBlocks(src);

  if (cls) {
    model.kind = "class";
    model.className = cls[1];
    model.superName = cls[2] ? cls[2].split(".").pop() : null;
    model.title = cls[1];

    // The description above the class, or the file header when that block is
    // only tags (a bare `@fires`, say).
    const above = blockAbove(blocks, cls.index);
    model.description = summaryText(above?.body) || header;

    model.ownProps = parseProps(src);

    for (const block of blocks) {
      const subject = subjectOf(src, block);
      if (!subject) continue;
      classify(subject, block, model);
    }
  } else {
    model.kind = "functions";
    model.title = path.basename(file);
    model.description = header || summaryText(blocks[0]?.body);
    for (const block of blocks) {
      const subject = subjectOf(src, block);
      if (!subject) continue;
      classifyFunction(subject, block, model);
    }
  }

  return model;
}

/** The run of `//` lines at the very top of the file, as plain text. */
function topComment(src) {
  const lines = src.split("\n");
  const out = [];
  for (const line of lines) {
    const m = /^\s*\/\/ ?(.*)$/.exec(line);
    if (m) out.push(m[1]);
    else if (line.trim() === "" && out.length === 0) continue;
    else break;
  }
  return out.join("\n").trim();
}

/** Every `/** … *\/` block, with its start, end, and inner body text. */
function docBlocks(src) {
  const blocks = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ start: m.index, end: re.lastIndex, body: m[1] });
  }
  return blocks;
}

/** The block that sits directly above `index`, or null. */
function blockAbove(blocks, index) {
  let best = null;
  for (const block of blocks) {
    if (block.end > index) break;
    // Only whitespace between the block's end and the declaration.
    best = block;
  }
  if (!best) return null;
  return best;
}

/** The first non-blank line of code after a block — its subject. */
function subjectOf(src, block) {
  const after = src.slice(block.end);
  for (const line of after.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    return t;
  }
  return "";
}

// --- classifying declarations ----------------------------------------------

/** Put a class member into the model under its visibility, if it has one. */
function classify(subject, block, model) {
  const vis = visibility(block.body);

  // An object-literal entry (`text: {…}`) — a prop, handled separately.
  if (/^[A-Za-z0-9_$]+\s*:/.test(subject)) return;

  // An instance variable: `this.name = …`.
  let m = /^this\.([A-Za-z0-9_$]+)\s*=/.exec(subject);
  if (m) {
    if (!vis) return;
    addUnique(model.properties, {
      name: m[1],
      kind: "field",
      visibility: vis,
      description: summaryText(block.body),
    });
    return;
  }

  // A getter or setter — a property, not a method.
  m = /^(?:static\s+)?(?:async\s+)?(get|set)\s+([A-Za-z0-9_$]+)\s*\(/.exec(subject);
  if (m) {
    if (!vis) return;
    const existing = model.properties.find((p) => p.name === m[2]);
    if (existing) {
      existing.accessor = true;
      if (!existing.description) existing.description = summaryText(block.body);
      if (vis === "public") existing.visibility = "public";
      return;
    }
    addUnique(model.properties, {
      name: m[2],
      kind: "accessor",
      accessor: true,
      visibility: vis,
      description: summaryText(block.body),
    });
    return;
  }

  // A static field like `styleName` — documented only when marked.
  m = /^static\s+([A-Za-z0-9_$]+)\s*=/.exec(subject);
  if (m) {
    if (m[1] === "props" || !vis) return;
    addUnique(model.properties, {
      name: m[1],
      kind: "static",
      visibility: vis,
      description: summaryText(block.body),
    });
    return;
  }

  // A method: `name(args)`, `async name(args)`.
  m = /^(?:static\s+)?(?:async\s+)?([A-Za-z0-9_$]+)\s*\(([^)]*)/.exec(subject);
  if (m) {
    if (m[1] === "constructor" || !vis) return;
    addUnique(model.methods, {
      name: m[1],
      signature: `${m[1]}(${m[2].trim()})`,
      visibility: vis,
      description: summaryText(block.body),
    });
  }
}

/** Put a standalone function or variable into a functions module, if public. */
function classifyFunction(subject, block, model) {
  if (visibility(block.body) !== "public") return;

  let m =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*\(([^)]*)/.exec(
      subject,
    );
  if (m) {
    addUnique(model.functions, {
      name: m[1],
      signature: `${m[1]}(${m[2].trim()})`,
      description: summaryText(block.body),
    });
    return;
  }

  // `export const name = (…) => …` or `= function (…)`.
  m = /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?(?:function\b[^(]*|\(([^)]*)\)\s*=>|([A-Za-z0-9_$]+)\s*=>)/.exec(
    subject,
  );
  if (m) {
    const params = m[2] ?? (m[3] ? m[3] : "");
    addUnique(model.functions, {
      name: m[1],
      signature: `${m[1]}(${params.trim()})`,
      description: summaryText(block.body),
    });
    return;
  }

  // A plain exported constant — a public variable.
  m = /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/.exec(subject);
  if (m) {
    addUnique(model.functions, {
      name: m[1],
      signature: m[1],
      variable: true,
      description: summaryText(block.body),
    });
  }
}

/** `public`, `protected`, or null, from a comment body. */
function visibility(body) {
  if (/@public\b/.test(body)) return "public";
  if (/@protected\b/.test(body)) return "protected";
  return null;
}

function addUnique(list, item) {
  if (!list.some((x) => x.name === item.name)) list.push(item);
}

// --- props ------------------------------------------------------------------

/** Parse `static props = { … }` into `[{name, type, default, description}]`. */
function parseProps(src) {
  const at = src.search(/static\s+props\s*=\s*\{/);
  if (at === -1) return [];
  const open = src.indexOf("{", at);
  const body = braced(src, open);
  if (body == null) return [];

  const props = [];
  let pending = null; // the comment above the next entry, single- or multi-line
  let buf = null; // accumulating a multi-line comment, or null
  for (const raw of body.split("\n")) {
    const line = raw.trim();

    // Inside a multi-line `/** … */`, gather until it closes.
    if (buf !== null) {
      const end = line.indexOf("*/");
      if (end === -1) {
        buf += "\n" + line;
      } else {
        pending = buf + "\n" + line.slice(0, end);
        buf = null;
      }
      continue;
    }

    if (line === "") continue;

    const oneLine = /^\/\*\*(.*?)\*\/\s*$/.exec(line);
    if (oneLine) {
      pending = oneLine[1];
      continue;
    }
    if (line.startsWith("/**")) {
      buf = line.slice(3);
      continue;
    }

    const entry = /^([A-Za-z0-9_$]+)\s*:\s*\{(.*)\}/.exec(line);
    if (entry) {
      const inner = entry[2];
      const type = /type\s*:\s*([A-Za-z0-9_$.]+)/.exec(inner);
      const def = /default\s*:\s*([^,}]+)/.exec(inner);
      props.push({
        name: entry[1],
        type: type ? type[1] : "",
        default: def ? def[1].trim() : "",
        description: summaryText(pending ?? ""),
      });
    }
    pending = null;
  }
  return props;
}

/** The text inside the braces beginning at `open`, brace-matched. */
function braced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// --- resolving inheritance --------------------------------------------------

/** Fill in ancestry, component-ness, and inherited props from other modules. */
function resolve(model, byName) {
  if (!model.className) return;

  // The chain from this class up, following supers that are documented here;
  // an undocumented super (the framework's `Component`) still names the chain.
  const chain = [];
  let name = model.superName;
  const seen = new Set([model.className]);
  while (name && !seen.has(name)) {
    seen.add(name);
    chain.push(name);
    const parent = byName.get(name);
    name = parent ? parent.superName : null;
  }

  model.isComponent = chain.includes("Component");
  if (model.isComponent) model.kind = "component";

  model.ancestry = [...chain].reverse().map((n) => ({
    name: n,
    htmlName: byName.get(n)?.htmlName ?? null,
  }));

  // Props, own over inherited, walking the documented supers.
  const merged = new Map();
  for (let i = chain.length - 1; i >= 0; i--) {
    const parent = byName.get(chain[i]);
    if (!parent) continue;
    for (const p of parent.ownProps) merged.set(p.name, { ...p, from: chain[i] });
  }
  for (const p of model.ownProps) merged.set(p.name, { ...p, from: null });
  model.allProps = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- text -------------------------------------------------------------------

/** The prose of a comment body: the summary before the first `@tag`. */
function summaryText(body) {
  if (!body) return "";
  const stripped = body
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .join("\n")
    // Visibility markers are not prose boundaries: the description often
    // follows one on the same line (`@public The text.`), so drop the marker
    // and keep what it introduces.
    .replace(/@(?:public|protected)\b[ \t]*/g, "");
  // Everything up to the first remaining block tag (@param, @returns, …).
  const cut = stripped.search(/(^|\n)\s*@\w+/);
  const text = (cut === -1 ? stripped : stripped.slice(0, cut)).trim();
  return text;
}

// --- rendering --------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A comment's prose as HTML: paragraphs, code blocks, and inline `code`. */
function prose(text) {
  if (!text) return "";
  const inline = (s) =>
    esc(s)
      .replace(/\{@link\s+([^}]+)\}/g, "$1")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const out = [];
  const lines = text.split("\n");
  let para = [];
  let code = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" ").trim())}</p>`);
    para = [];
  };
  const flushCode = () => {
    if (code.length) out.push(`<pre>${esc(code.join("\n"))}</pre>`);
    code = [];
  };
  for (const line of lines) {
    if (/^\s{2,}\S/.test(line)) {
      flushPara();
      code.push(line.replace(/^\s{2}/, ""));
    } else if (line.trim() === "") {
      flushPara();
      flushCode();
    } else {
      flushCode();
      para.push(line.trim());
    }
  }
  flushPara();
  flushCode();
  return out.join("\n");
}

function renderHierarchy(model, byName) {
  if (!model.ancestry.length) return "";
  const links = model.ancestry.map((a) =>
    a.htmlName
      ? `<a href="${a.htmlName}">${esc(a.name)}</a>`
      : `<span>${esc(a.name)}</span>`,
  );
  links.push(`<strong>${esc(model.className)}</strong>`);
  return `<p class="hierarchy">${links.join(" <span class=\"arrow\">›</span> ")}</p>`;
}

function renderProps(model) {
  if (!model.allProps.length) return "";
  const rows = model.allProps
    .map((p) => {
      const from = p.from ? `<span class="from">${esc(p.from)}</span>` : "";
      return `<tr>
        <td><code>${esc(p.name)}</code>${from}</td>
        <td>${p.type ? `<code>${esc(p.type)}</code>` : "—"}</td>
        <td>${p.default ? `<code>${esc(p.default)}</code>` : "—"}</td>
        <td>${prose(p.description) || ""}</td>
      </tr>`;
    })
    .join("\n");
  return `<section>
    <h2>Props</h2>
    <p class="note">What markup may set on this component, its own and inherited.</p>
    <table>
      <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function memberList(items) {
  return `<dl class="members">${items
    .map(
      (it) => `<dt><code>${esc(it.signature ?? it.name)}</code>${
        it.accessor ? '<span class="tag">accessor</span>' : ""
      }</dt><dd>${prose(it.description) || "<em>No description.</em>"}</dd>`,
    )
    .join("\n")}</dl>`;
}

function renderClassSections(model) {
  const out = [];
  const pubProps = model.properties.filter((p) => p.visibility === "public");
  const protProps = model.properties.filter((p) => p.visibility === "protected");
  const pubMethods = model.methods.filter((m) => m.visibility === "public");
  const protMethods = model.methods.filter((m) => m.visibility === "protected");

  if (pubProps.length)
    out.push(`<section><h2>Public Properties</h2>${memberList(pubProps)}</section>`);
  if (protProps.length)
    out.push(
      `<section><h2>Protected Properties</h2>${memberList(protProps)}</section>`,
    );
  if (pubMethods.length)
    out.push(`<section><h2>Public Methods</h2>${memberList(pubMethods)}</section>`);
  if (protMethods.length)
    out.push(
      `<section><h2>Protected Methods</h2>${memberList(protMethods)}</section>`,
    );
  return out.join("\n");
}

function renderFunctions(model) {
  if (!model.functions.length)
    return `<p class="note">No public functions.</p>`;
  return `<section><h2>Public Functions</h2>${memberList(model.functions)}</section>`;
}

function renderPage(model, byName) {
  const kindLabel =
    model.kind === "component"
      ? "Component"
      : model.kind === "class"
        ? "Class"
        : "Module";

  const body =
    model.kind === "functions"
      ? renderFunctions(model)
      : renderProps(model) + renderClassSections(model);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header><a href="../index.html">← Index</a><span class="path">${esc(model.rel)}</span></header>
<main>
  <p class="kind">${kindLabel}</p>
  <h1>${esc(model.title)}</h1>
  ${model.kind !== "functions" ? renderHierarchy(model, byName) : ""}
  <div class="description">${prose(model.description) || "<em>No description.</em>"}</div>
  ${body}
</main>
</body>
</html>
`;
}

function renderIndex(modules, title) {
  const groups = new Map();
  for (const m of modules) {
    const dir = m.rel.includes("/") ? m.rel.slice(0, m.rel.lastIndexOf("/")) : ".";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(m);
  }
  const sections = [...groups.keys()]
    .sort()
    .map((dir) => {
      const items = groups
        .get(dir)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((m) => {
          const badge = `<span class="badge ${m.kind}">${m.kind}</span>`;
          return `<li><a href="${PAGES_DIR}/${m.htmlName}">${esc(m.title)}</a>${badge}</li>`;
        })
        .join("\n");
      return `<section><h2>${esc(dir === "." ? "/" : dir)}</h2><ul class="index">${items}</ul></section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="note">${modules.length} file${modules.length === 1 ? "" : "s"}.</p>
  ${sections}
</main>
</body>
</html>
`;
}

const CSS = `
:root {
  --bg: #ffffff; --fg: #1b1b1f; --muted: #6a6a72; --line: #e3e3e8;
  --accent: #3b5bdb; --code-bg: #f4f4f7; --card: #fafafc;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --fg: #e6e6ea; --muted: #9a9aa4; --line: #2a2a31;
    --accent: #8aa0ff; --code-bg: #1f1f26; --card: #1b1b21;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header {
  display: flex; gap: 1rem; align-items: baseline;
  padding: .75rem 1.25rem; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--bg);
}
header a { color: var(--accent); text-decoration: none; font-weight: 600; }
header .path { color: var(--muted); font-size: .85em; font-family: ui-monospace, monospace; }
main { max-width: 860px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
h1 { margin: .2rem 0 .6rem; font-size: 1.9rem; }
h2 { margin: 2rem 0 .6rem; font-size: 1.15rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
.kind { text-transform: uppercase; letter-spacing: .08em; font-size: .72rem; color: var(--muted); margin: 0; }
.hierarchy { color: var(--muted); font-size: .9rem; margin: .2rem 0 1rem; }
.hierarchy .arrow { opacity: .6; }
.hierarchy a { color: var(--accent); text-decoration: none; }
.note { color: var(--muted); font-size: .9rem; }
.description p { margin: .6rem 0; }
code { background: var(--code-bg); padding: .1em .35em; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
pre { background: var(--code-bg); padding: .8rem 1rem; border-radius: 8px; overflow-x: auto; }
pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; line-height: 1.5; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0; font-size: .92rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; }
.from { display: inline-block; margin-left: .4rem; font-size: .72rem; color: var(--muted); }
dl.members { margin: .4rem 0; }
dl.members dt { margin-top: 1rem; }
dl.members dt code { background: none; padding: 0; font-weight: 600; color: var(--fg); font-size: .95em; }
dl.members dd { margin: .2rem 0 0; padding-left: 1rem; border-left: 2px solid var(--line); color: var(--fg); }
dl.members dd p:first-child { margin-top: 0; }
.tag { margin-left: .5rem; font-size: .68rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 .5em; }
ul.index { list-style: none; padding: 0; }
ul.index li { display: flex; align-items: center; gap: .6rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
ul.index a { color: var(--accent); text-decoration: none; font-weight: 500; }
.badge { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; padding: .05em .5em; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.component { color: var(--accent); border-color: var(--accent); }
`;
