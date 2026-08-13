// JSX transform for `.jsx` and `.js` sources.
//
// A `.jsx` file is ordinary JavaScript that may contain JSX expressions —
// typically inside a `Component` subclass's `draw()` method. Only the JSX is
// rewritten, into `h()` calls; every other byte is copied through untouched.
//
// Unlike `.mib` markup, JSX here sits inside real JavaScript, so `{...}` holds
// an arbitrary expression rather than a property path. `styleName`,
// `outlet` and `action` mean the same thing in both.

import * as fs from "node:fs";
import * as path from "node:path";

import * as css from "./css.js";
import {
  ACTION_ATTR,
  isIdent,
  jsKey,
  jsString,
  lineMarker,
  OUTLET_ATTR,
  splitInclusive,
  STYLE_NAME_ATTR,
  takeLineMarkers,
  VIEW_TAG,
} from "./js.js";

export class JsxError extends Error {}

/**
 * Transform JSX to `h()` calls. `scope` is the component's scope class — its
 * hash — carried by every DOM element so the module's scoped CSS matches it,
 * the same contract as `.mib` markup.
 */
export function transform(src, scope = null) {
  return new Jsx(src, scope).program();
}

/** Characters after which a `<` opens JSX rather than meaning "less than". */
const EXPR_POSITION = new Set([
  "(",
  ",",
  "=",
  "{",
  "}",
  "[",
  ";",
  ":",
  "?",
  "&",
  "|",
  "!",
  "+",
  "-",
  "*",
  "%",
  ">",
  "",
]);

class Jsx {
  constructor(src, scope) {
    this.src = src;
    this.pos = 0;
    this.scope = scope;
  }

  get eof() {
    return this.pos >= this.src.length;
  }

  peek() {
    return this.src[this.pos] ?? "";
  }

  at(offset) {
    return this.src[this.pos + offset] ?? "";
  }

  rest() {
    return this.src.slice(this.pos);
  }

  line() {
    let n = 1;
    for (let i = 0; i < this.pos; i++) if (this.src[i] === "\n") n++;
    return n;
  }

  err(msg) {
    return new JsxError(`line ${this.line()}: ${msg}`);
  }

  /**
   * Copy JavaScript through, transforming any JSX found in expression
   * position. Strings, template literals and comments are opaque.
   */
  program() {
    let out = "";
    // The last non-whitespace character emitted decides whether a `<` opens
    // JSX or is a comparison operator.
    let prev = "";

    while (!this.eof) {
      const c = this.peek();
      if (c === '"' || c === "'" || c === "`") {
        out += this.copyString();
        prev = "x";
      } else if (c === "/" && (this.at(1) === "/" || this.at(1) === "*")) {
        out += this.copyComment();
      } else if (c === "<" && this.jsxStartsHere(prev)) {
        out += this.element();
        prev = ")";
      } else {
        out += c;
        this.pos++;
        // A marker after each newline keeps generated lines tied to the source
        // lines they were copied from.
        if (c === "\n") out += lineMarker(this.line());
        if (!/\s/.test(c)) prev = c;
      }
    }
    return out;
  }

  /**
   * `<` opens JSX only in expression position: after `return`, an operator, or
   * an opening bracket — never after an identifier or a closing bracket, where
   * it means "less than".
   */
  jsxStartsHere(prev) {
    const next = this.at(1);
    const plausible =
      /[\p{L}]/u.test(next) || next === ">" || next === "_" || next === "$";
    if (!plausible) return false;
    if (EXPR_POSITION.has(prev)) return true;
    // `return <div/>` — the only keyword case that matters in practice.
    const before = this.src.slice(0, this.pos).trimEnd();
    return (
      before.endsWith("return") ||
      before.endsWith("=>") ||
      before.endsWith("default")
    );
  }

  copyString() {
    const quote = this.peek();
    const start = this.pos;
    this.pos++;
    while (!this.eof) {
      const c = this.peek();
      if (c === "\\") {
        this.pos += 2;
        continue;
      }
      if (c === quote) {
        this.pos++;
        return this.src.slice(start, this.pos);
      }
      // `${ ... }` inside a template literal may contain anything.
      if (quote === "`" && c === "$" && this.at(1) === "{") {
        const head = this.src.slice(start, this.pos);
        this.pos++;
        const inner = this.braced();
        const tail = this.copyStringFrom(quote);
        return `${head}\${${transform(inner, this.scope)}}${tail}`;
      }
      this.pos++;
    }
    throw this.err("unterminated string literal");
  }

  /** Continue copying a template literal after an interpolation. */
  copyStringFrom(quote) {
    const start = this.pos;
    while (!this.eof) {
      const c = this.peek();
      if (c === "\\") {
        this.pos += 2;
        continue;
      }
      if (c === quote) {
        this.pos++;
        return this.src.slice(start, this.pos);
      }
      if (c === "$" && this.at(1) === "{") {
        const head = this.src.slice(start, this.pos);
        this.pos++;
        const inner = this.braced();
        const tail = this.copyStringFrom(quote);
        return `${head}\${${transform(inner, this.scope)}}${tail}`;
      }
      this.pos++;
    }
    throw this.err("unterminated template literal");
  }

  copyComment() {
    const start = this.pos;
    if (this.at(1) === "/") {
      while (!this.eof && this.peek() !== "\n") this.pos++;
    } else {
      this.pos += 2;
      while (!this.eof && !(this.peek() === "*" && this.at(1) === "/"))
        this.pos++;
      this.pos = Math.min(this.pos + 2, this.src.length);
    }
    return this.src.slice(start, this.pos);
  }

  /** Consume a `{ ... }` run, returning the inner source untransformed. */
  braced() {
    if (this.peek() !== "{") throw this.err("expected `{`");
    this.pos++;
    const start = this.pos;
    let depth = 1;
    while (!this.eof) {
      const c = this.peek();
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          const inner = this.src.slice(start, this.pos);
          this.pos++;
          return inner;
        }
      } else if (c === '"' || c === "'" || c === "`") {
        this.copyString();
        continue;
      }
      this.pos++;
    }
    throw this.err("unterminated `{`");
  }

  skipWs() {
    while (!this.eof && /\s/.test(this.peek())) this.pos++;
  }

  /** `<tag ...>children</tag>`, `<tag ... />` or a `<>fragment</>`. */
  element() {
    const line = this.line();
    this.pos++; // `<`
    const name = this.tagName();

    const props = [];
    const spreads = [];
    // Held aside so the scope can join it: the scope is a class, not a prop of
    // its own, and `class` may be written once at most.
    let classValue = null;
    let selfClosing = false;
    const isComponent =
      name !== "" &&
      (isUpper(name[0]) || name.includes(".")) &&
      name !== VIEW_TAG;

    for (;;) {
      this.skipWs();
      if (this.eof) throw this.err(`unterminated <${name}> tag`);
      if (this.rest().startsWith("/>")) {
        this.pos += 2;
        selfClosing = true;
        break;
      }
      if (this.peek() === ">") {
        this.pos++;
        break;
      }
      if (this.peek() === "{") {
        const inner = this.braced().trim();
        if (!inner.startsWith("..."))
          throw this.err("expected {...spread} in tag");
        spreads.push(transform(inner.slice(3).trim(), this.scope));
        continue;
      }
      for (const [key, value] of this.attribute(isComponent)) {
        if (key === "class") classValue = value;
        else props.push(`${key}: ${value}`);
      }
    }

    // A DOM element carries the module's scope class; components style their
    // own markup, and a fragment is not an element at all.
    const scope = !isComponent && name !== "" && this.scope ? this.scope : null;
    if (scope !== null) {
      // A literal joins the string; anything else is a list the runtime
      // flattens, which is what `class` already accepts.
      classValue =
        classValue === null
          ? jsString(scope)
          : classValue.startsWith('"')
            ? jsString(`${JSON.parse(classValue)} ${scope}`.trim())
            : `[${classValue}, ${jsString(scope)}]`;
    }
    if (classValue !== null) props.unshift(`class: ${classValue}`);

    const children = selfClosing ? [] : this.children(name);

    // `<View>` is the built-in root element, a plain <div>.
    let tag;
    if (name === "") tag = "Fragment";
    else if (name === VIEW_TAG) tag = jsString("div");
    else if (isComponent) tag = name;
    else tag = jsString(name);

    let propsExpr;
    if (spreads.length === 0) {
      propsExpr = props.length === 0 ? "null" : `{ ${props.join(", ")} }`;
    } else {
      const parts = spreads.map((s) => `(${s})`);
      if (props.length > 0) parts.push(`{ ${props.join(", ")} }`);
      propsExpr = `Object.assign({}, ${parts.join(", ")})`;
    }

    if (children.length === 0) {
      return `${lineMarker(line)}h(${tag}, ${propsExpr})`;
    }
    return `${lineMarker(line)}h(${tag}, ${propsExpr}, ${children.join(", ")})`;
  }

  tagName() {
    const start = this.pos;
    while (!this.eof && /[\p{L}\p{N}\-_.$]/u.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /**
   * One attribute, returning the props it emits. `action` may name several
   * `event:method` pairs and so yields one prop per pair.
   */
  attribute(isComponent) {
    const start = this.pos;
    while (!this.eof) {
      const c = this.peek();
      if (/\s/.test(c) || c === "=" || c === ">" || c === "/") break;
      this.pos++;
    }
    if (start === this.pos)
      throw this.err(`unexpected \`${this.peek()}\` in tag`);
    const name = this.src.slice(start, this.pos);
    const isDirective = name === OUTLET_ATTR || name === ACTION_ATTR;

    if (name === "class")
      throw this.err(`use \`${STYLE_NAME_ATTR}\` instead of \`class\``);

    // No `=`: a boolean attribute. Directives always need a value.
    if (this.peek() !== "=") {
      if (isDirective) throw this.err(`\`${name}\` needs a value`);
      return [[jsKey(attrKey(name, isComponent)), "true"]];
    }
    this.pos++;

    if (this.peek() === "{") {
      const expr = this.braced();
      if (isDirective)
        throw this.err(`\`${name}\` takes a quoted string, not {...}`);
      return [
        [
          jsKey(attrKey(name, isComponent)),
          `(${transform(expr.trim(), this.scope)})`,
        ],
      ];
    }

    const value = this.quotedValue(name);
    if (isDirective) return this.directive(name, value, isComponent);
    return [[jsKey(attrKey(name, isComponent)), jsString(value)]];
  }

  /** A quoted attribute value; the `=` has already been consumed. */
  quotedValue(name) {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw this.err(`\`${name}\` must be a quoted string or {expression}`);
    }
    this.pos++;
    const start = this.pos;
    while (!this.eof && this.peek() !== quote) this.pos++;
    if (this.eof) throw this.err("unterminated attribute value");
    const value = this.src.slice(start, this.pos);
    this.pos++;
    return value;
  }

  directive(name, rawValue, isComponent) {
    const value = rawValue.trim();
    if (name === OUTLET_ATTR) {
      if (!isIdent(value))
        throw this.err(`\`${OUTLET_ATTR}\` must be an identifier`);
      return [["ref", `(__el) => { this.${value} = __el; }`]];
    }

    // `action="pointerdown:onDown keyup:onUp"` — whitespace-separated
    // `event:method` pairs. On a DOM element a bare method means click; on a
    // component it means the component's own action.
    const out = [];
    for (const part of value.split(/\s+/).filter(Boolean)) {
      const colon = part.indexOf(":");
      const event = colon === -1 ? null : part.slice(0, colon).trim();
      const method = colon === -1 ? part : part.slice(colon + 1).trim();

      if (!isIdent(method)) {
        throw this.err(
          `\`${ACTION_ATTR}\`: \`${method}\` is not a method name`,
        );
      }
      const key = isComponent
        ? event === null
          ? ACTION_ATTR
          : `${event}Action`
        : `on${(event ?? "click").toLowerCase()}`;
      if (out.some(([k]) => k === jsKey(key))) {
        throw this.err(`\`${ACTION_ATTR}\`: \`${key}\` is bound twice`);
      }
      out.push([jsKey(key), `(...__a) => this.${method}(...__a)`]);
    }
    if (out.length === 0) throw this.err(`\`${ACTION_ATTR}\` is empty`);
    return out;
  }

  /** Children up to the matching close tag. */
  children(name) {
    const out = [];
    let text = "";

    for (;;) {
      if (this.eof) throw this.err(`unclosed <${name}>`);

      if (this.rest().startsWith("</")) {
        text = pushText(out, text);
        this.pos += 2;
        const close = this.tagName();
        this.skipWs();
        if (this.peek() !== ">") throw this.err(`malformed </${close}>`);
        this.pos++;
        if (close !== name)
          throw this.err(`expected </${name}>, found </${close}>`);
        return out;
      }

      if (this.peek() === "<") {
        text = pushText(out, text);
        out.push(this.element());
        continue;
      }

      if (this.peek() === "{") {
        text = pushText(out, text);
        const expr = this.braced().trim();
        if (expr !== "") out.push(`(${transform(expr, this.scope)})`);
        continue;
      }

      text += this.peek();
      this.pos++;
    }
  }
}

function isUpper(c) {
  return c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Flush pending text, dropping whitespace that is only source formatting. */
function pushText(out, raw) {
  if (raw.trim() === "") return "";
  // Collapse the indentation around a newline, as JSX does.
  let value = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
  if (/^\s/.test(raw) && !raw.startsWith("\n")) value = " " + value;
  if (/\s$/.test(raw) && !raw.endsWith("\n")) value += " ";
  out.push(jsString(value));
  return "";
}

/**
 * Markup says `styleName`; the DOM wants `class`. Component props keep the
 * name they were written with.
 */
function attrKey(name, isComponent) {
  return name === STYLE_NAME_ATTR && !isComponent ? "class" : name;
}

/**
 * Replace side-effect CSS imports with a runtime `addStyles` call, so
 * `import "./counter.css";` works in a browser with no bundler. The stylesheet
 * is inlined and scoped to this module at compile time, exactly as a `.mib`
 * file's `<style>` block is; `:global(...)` opts out.
 *
 * @returns `[code, foundAny]`
 */
export function inlineCssImports(code, dir, scope = null, options = {}) {
  let out = "";
  let found = false;

  for (const line of splitInclusive(code)) {
    // The line may carry source-map markers by now; judge it without them.
    const [clean] = takeLineMarkers(line);
    const trimmed = clean.trim();
    const isCssImport =
      trimmed.startsWith("import ") &&
      !trimmed.includes(" from ") &&
      (trimmed.includes('.css"') || trimmed.includes(".css'"));

    if (!isCssImport) {
      out += line;
      continue;
    }

    const spec = trimmed
      .replace(/^import/, "")
      .trim()
      .replace(/;+$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const file = path.join(dir, spec);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new JsxError(`${file}: ${e.message}`);
    }
    if (scope) text = css.scope(text, `.${scope}`, null, {minify: options.minify});

    const key = path.basename(file, path.extname(file));

    // Keep any leading marker so the statement still maps to its source line.
    const markerEnd = line.lastIndexOf("*/");
    out += markerEnd === -1 ? "" : line.slice(0, markerEnd + 2);
    out += `addStyles(${jsString(key)}, ${jsString(text.trimEnd())});`;
    if (line.endsWith("\n")) out += "\n";
    found = true;
  }

  return [out, found];
}

/** How an icon is named: `import Chevron from "svg:chevron-down";` */
const SVG_PREFIX = "svg:";

/**
 * Replace an icon import with the icon.
 *
 *   import Chevron from "svg:chevron-down";
 *
 * The file is found in the icon directories the build knows about, read at
 * compile time and emitted as the component that draws it — the same idea as
 * SvgIconLibrary.getIcon("svg:chevron-down") in the Java original, settled
 * before the page is opened rather than looked up while it runs. Nothing is
 * fetched, and an icon that is not there is a build error rather than a hole
 * in the page.
 *
 * The component takes props and spreads them onto the `<svg>`, so an icon is
 * sized and styled where it is used:
 *
 *   <Chevron styleName="chevron"/>
 *
 * @param dirs directories to look in, nearest first
 * @returns `[code, foundAny]`
 */
export function inlineSvgImports(code, dirs = [], scope = null) {
  let out = "";
  let found = false;

  for (const line of splitInclusive(code)) {
    const [clean] = takeLineMarkers(line);
    const match = clean
      .trim()
      .match(
        /^import\s+([\p{L}_$][\p{L}\p{N}_$]*)\s+from\s+["']svg:([^"']+)["'];?$/u,
      );

    if (!match) {
      out += line;
      continue;
    }

    const [, name, icon] = match;
    const file = findIcon(icon, dirs);
    const svg = fs.readFileSync(file, "utf8").trim();

    // The icon is markup, and is transformed exactly as the JSX in a `draw()`
    // is — it is the same syntax, and this way an icon is vnodes rather than a
    // string the page would have to parse.
    const vnode = transform(`(${svg})`, scope).trim();

    const markerEnd = line.lastIndexOf("*/");
    out += markerEnd === -1 ? "" : line.slice(0, markerEnd + 2);
    out +=
      `const ${name} = (props = {}) => { const __icon = ${vnode}; ` +
      `return { ...__icon, props: { ...__icon.props, ...props } }; };`;
    if (line.endsWith("\n")) out += "\n";
    found = true;
  }

  return [out, found];
}

/** Where an icon lives, searched nearest first. */
function findIcon(icon, dirs) {
  const name = icon.endsWith(".svg") ? icon : `${icon}.svg`;

  for (const dir of dirs) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }

  const looked =
    dirs.length > 0
      ? dirs.join(", ")
      : "nowhere — no icon directories are configured";
  throw new JsxError(`no icon "${SVG_PREFIX}${icon}" — looked in ${looked}`);
}

/**
 * Make sure the runtime names a compiled file needs are in scope: merge them
 * into an existing import from the runtime, or prepend one. Without this, a
 * `.js` source that only imports `Component` would reference an undefined `h`.
 */
export function ensureRuntimeNames(code, runtime, needed) {
  const stmt = findRuntimeImport(code, runtime);
  if (stmt) {
    const { start, end, namesStart, namesEnd } = stmt;
    const have = code
      .slice(namesStart, namesEnd)
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n !== "");
    const missing = needed.filter(
      (n) => !have.some((h) => h === n || h.endsWith(` ${n}`)),
    );
    if (missing.length === 0) return code;
    const merged = `import { ${[...missing, ...have].join(", ")} } from ${jsString(runtime)};`;
    return code.slice(0, start) + merged + code.slice(end);
  }

  return `import { ${needed.join(", ")} } from ${jsString(runtime)};\n${code}`;
}

/**
 * Locate the module's own import of the runtime.
 *
 * The specifier is compared whole, never by substring: a compiled module can
 * carry its stylesheet as a string literal, and a bare runtime name like
 * `mosaic` appears inside every scope attribute in it. Matching is on the
 * specifier's file name too, because a source's relative path to mosaic.js is
 * written for where the *source* lives, while the compiled file may land
 * somewhere else. Either way the specifier is rewritten to the one given.
 */
function findRuntimeImport(code, runtime) {
  const wanted = basename(runtime);
  const pattern = /import\s*\{([^}]*)\}\s*from\s*("[^"]*"|'[^']*')\s*;?/g;

  for (const match of code.matchAll(pattern)) {
    const specifier = match[2].slice(1, -1);
    if (specifier !== runtime && basename(specifier) !== wanted) continue;

    const start = match.index;
    const namesStart = start + match[0].indexOf("{") + 1;
    const namesEnd = start + match[0].indexOf("}");
    return { start, end: start + match[0].length, namesStart, namesEnd };
  }
  return null;
}

/** `../a/mosaic.js` and `mosaic` both name `mosaic`. */
function basename(specifier) {
  return specifier.split("/").pop().replace(/\.js$/, "");
}
