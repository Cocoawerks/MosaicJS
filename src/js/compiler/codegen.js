// Emits an ES module that builds the component's markup with `h()` calls.

import * as css from "./css.js";
import {transform} from "./jsx.js";
import {ACTION_ATTR, jsKey, jsString, lineMarker, scopeClass, STYLE_NAME_ATTR, VIEW_TAG,} from "./js.js";

/**
 * @param comp  the parsed component
 * @param opts  { runtime, name, hash, resolve } — runtime import specifier,
 *              exported component name, the scope hash derived from the
 *              source, and a `name -> specifier` lookup for component tags.
 */
export function generate(comp, opts) {
  const scope = scopeClass(opts.hash);
  const hasStyle = comp.style.trim() !== "";

  const imports = ["h", "Fragment"];
  if (usesTextBinding(comp.markup)) imports.push("bindText");
  if (usesAttrBinding(comp.markup)) imports.push("bindAttr");
  if (hasStyle) imports.push("addStyles");
  // A page that declares its own controller registers it, which is the only
  // thing here that needs the application class.
  if (opts.entry && /(^|\n)\s*export\s+default\s/.test(comp.script ?? "")) {
    imports.push("MosaicApplication");
  }

  // What the `<script>` brings into scope itself. It is JavaScript, and says
  // what it depends on the way any module does — `Component` and every
  // component its JSX draws are its own to import.
  const inScope = scriptNames(comp.script);
  const script = hoistScript(comp, hasStyle ? scope : null, opts);

  let out = `import { ${imports.join(", ")} } from ${jsString(opts.runtime)};\n\n`;

  // Every capitalised tag is another compiled module. Where it lands is the
  // caller's business — a component library compiles somewhere of its own, so
  // assuming a sibling would emit an import that resolves to nothing.
  //
  // Unless the `<script>` block already put the name in scope: a component
  // declared or imported there is this file's own, and importing it again
  // would look for a module that was never meant to exist.
  const tags = componentTags(comp.markup).filter((name) => !inScope.has(name));
  const resolve = opts.resolve ?? ((name) => `./${name}.js`);
  for (const name of tags) {
    out += `import ${name} from ${jsString(resolve(name))};\n`;
  }
  if (tags.length > 0) out += "\n";

  // A component the script draws has to be in scope by the time it runs: from
  // the script's own imports, or from the markup's. Saying so here beats an
  // "X is not defined" when the page is opened.
  for (const name of componentRefs(script.code)) {
    if (!inScope.has(name) && !tags.includes(name)) {
      throw new Error(
          `<${name}/> is drawn in the <script> but nothing imports it — ` +
          `add an import for it to the script`,
      );
    }
  }

  if (hasStyle) {
    // Namespaced by component: bundling puts every module in one scope, where
    // a bare `CSS` would collide.
    const cssVar = `CSS_${opts.name}`;
    out += `const ${cssVar} = ${jsString(css.scope(comp.style, `.${scope}`))};\n`;
    out += `addStyles(${jsString(opts.hash)}, ${cssVar});\n\n`;
  }

  // The script is this file's JavaScript, at module scope so the markup below
  // can reach what it declares — most often the controller.
  out += script.code;

  // `props` carries initial values only — it is forwarded to child components
  // and is otherwise the controller's business. There is no reactivity.
  out += `export default function ${opts.name}(props = {}) {\n`;
  const ctx = new Ctx(hasStyle ? scope : null);
  out += `  return ${ctx.childrenExpr(comp.markup, 1)};\n}\n`;
  out += script.tail;
  return out;
}

/**
 * Hoist a `<script>` block into module scope.
 *
 * The code is JavaScript and is emitted as written — it is not markup, and not
 * JSX. The one thing given meaning is `export default`: a module already
 * default-exports its component, so the script's default is taken to be the
 * page's controller, exported as `Controller`. For the application's own page
 * it is registered too, which is what lets a whole app be one `.mib` file.
 */
function hoistScript(comp, scopeAttr, opts) {
  const script = comp.script;
  if (!script || script.trim() === "") return {code: "", tail: ""};

  const {code, controller} = takeDefaultExport(script);

  // The script is JavaScript, and may hold JSX — a component drawn right here
  // is the reason to write one. It is transformed exactly as a `.js` source
  // is, scope attribute included, so an inline component's markup is styled by
  // this file's `<style>` like everything else in it.
  const transformed = shiftMarkers(transform(code, scopeAttr), comp.scriptLine - 1);

  let out = `${transformed.trim()}\n`;
  let tail = "";

  if (controller) {
    tail += `\nexport { ${controller} as Controller };\n`;
    if (opts.entry) tail += `MosaicApplication.registerController(${controller});\n`;
  }
  return {code: out, tail};
}

/**
 * Move the transformed script's line markers to the lines they occupy in the
 * `.mib` file, so devtools land on the block rather than `offset` lines above it.
 */
function shiftMarkers(code, offset) {
  if (offset === 0) return code;
  return code.replace(/\/\*@L(\d+)\*\//g, (_, n) => lineMarker(Number(n) + offset));
}

/**
 * Split `export default ...` out of a script, returning the code with a named
 * declaration in its place and the name it bound.
 */
function takeDefaultExport(script) {
  const match = script.match(/(^|\n)\s*export\s+default\s+/);
  if (!match) return {code: script, controller: null};

  const at = match.index + match[0].length;
  const before = script.slice(0, match.index + (match[1] ? 1 : 0));
  const rest = script.slice(at);

  // `export default class Name` / `function Name` keeps the name it was given.
  const named = rest.match(/^(class|function)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u);
  if (named) return {code: `${before}${rest}`, controller: named[2]};

  // Anything else — an anonymous class, an object literal — needs a name to be
  // referred to by, and the statement needs its terminator back.
  const NAME = "__Controller";
  const body = rest.replace(/;\s*$/, "");
  return {code: `${before}const ${NAME} = ${body};`, controller: NAME};
}

/**
 * The names a `<script>` block puts in module scope: what it declares, and
 * what it imports.
 *
 * Module scope is decided by nesting, not by indentation — the block's
 * contents sit inside a tag, so how far they are indented is formatting and
 * nothing more. A `class` inside a function is that function's; a `class`
 * written flush left and one written four spaces in are both this module's.
 */
function scriptNames(script) {
  const names = new Set();
  if (!script) return names;

  const IDENT = "[\\p{L}_$][\\p{L}\\p{N}_$]*";

  for (const text of topLevelLines(script)) {

    // `import X from`, `import { A, B as C } from`, `import * as NS from`
    const imported = text.match(/^import\s+([^"']*?)\s+from\s/u);
    if (imported) {
      for (const part of imported[1].split(/[{},]/)) {
        const name = part.trim().replace(/^\*\s*/, "").split(/\s+as\s+/).pop()?.trim();
        if (name && new RegExp(`^${IDENT}$`, "u").test(name)) names.add(name);
      }
      continue;
    }

    // `class X`, `function X`, `const X`, and the exported forms of each.
    const declared = text.match(
        new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:class|function|const|let|var)\\s+(${IDENT})`, "u"),
    );
    if (declared) names.add(declared[1]);
  }
  return names;
}

/**
 * Components the script's JSX resolved to. Read from the transformed code, so
 * it is what the transform actually decided was a component — not a guess at
 * what a `<` in a string might have meant.
 */
function componentRefs(code) {
  const names = [];
  for (const match of code.matchAll(/\bh\(\s*([\p{Lu}][\p{L}\p{N}_$]*)/gu)) {
    if (match[1] !== "Fragment" && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * The lines of `script` that sit at its top level, trimmed.
 *
 * Depth is counted in brackets, so what a line is nested inside decides
 * whether it belongs to the module. Comments and the insides of strings are
 * blanked first: a brace in either is text, not structure.
 */
function topLevelLines(script) {
  const source = blankLiterals(script);
  const lines = [];
  let depth = 0;

  for (const line of source.split("\n")) {
    if (depth === 0) lines.push(line.trim());
    for (const c of line) {
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") depth--;
    }
  }
  return lines;
}

/**
 * Replace the contents of comments and string literals with spaces, keeping
 * every other character where it was. Only used to judge structure — the code
 * that is emitted is the code that was written.
 */
function blankLiterals(source) {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out += " ", i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) out += source[i] === "\n" ? "\n" : " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) out += c, i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Components referenced by the markup, deduplicated and in source order.
 * `<View>` is built in, and a dotted tag imports its namespace root.
 */
function componentTags(nodes, out = []) {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    const isComponent = isUpper(node.name[0]) || node.name.includes(".");
    if (isComponent && node.name !== VIEW_TAG) {
      const root = node.name.split(".")[0];
      if (!out.includes(root)) out.push(root);
    }
    componentTags(node.children, out);
  }
  return out;
}

function isUpper(c) {
  return c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Does the tree contain `{path}` in text? */
function usesTextBinding(nodes) {
  return nodes.some(
    (n) => n.kind === "bind" || (n.kind === "element" && usesTextBinding(n.children)),
  );
}

/** Does the tree contain `{path}` inside an attribute value? */
function usesAttrBinding(nodes) {
  return nodes.some(
    (n) =>
      n.kind === "element" &&
      (n.attrs.some((a) => a.value.kind === "template") || usesAttrBinding(n.children)),
  );
}

class Ctx {
  /** `null` when the component has no styles — nothing is scoped then. */
  constructor(scope) {
    this.scope = scope;
  }

  /**
   * A single JS expression for a child list: one node inline, many wrapped in
   * a Fragment so a component always returns one vnode.
   */
  childrenExpr(nodes, indent) {
    if (nodes.length === 0) return "null";
    if (nodes.length === 1) return this.nodeExpr(nodes[0], indent);
    const pad = "  ".repeat(indent + 1);
    const items = nodes.map((n) => pad + this.nodeExpr(n, indent + 1));
    return `h(Fragment, null,\n${items.join(",\n")}\n${"  ".repeat(indent)})`;
  }

  nodeExpr(node, indent) {
    if (node.kind === "text") return jsString(node.text);
    // The runtime creates the text node and remembers it, so a later
    // `refresh(controller)` can re-read the path and update it.
    if (node.kind === "bind") {
      return `${lineMarker(node.line)}bindText(this, ${jsString(node.path)})`;
    }
    return lineMarker(node.line) + this.elementExpr(node, indent);
  }

  elementExpr(node, indent) {
    const { name, attrs, outlet, actions, children } = node;

    // `<View styleName="counter">` is the built-in root element: a plain
    // `<div>`, styled like any other element.
    if (name === VIEW_TAG) {
      return this.elementExpr({ ...node, name: "div" }, indent);
    }

    // Capitalised (or dotted) names resolve to a component in scope.
    const isComponent = isUpper(name[0]) || name.includes(".");
    const tag = isComponent ? name : jsString(name);

    const props = this.propsExpr(name, attrs, outlet, actions, isComponent);

    if (children.length === 0) return `h(${tag}, ${props})`;

    const pad = "  ".repeat(indent + 1);
    const kids = children.map((c) => pad + this.nodeExpr(c, indent + 1));
    return `h(${tag}, ${props},\n${kids.join(",\n")}\n${"  ".repeat(indent)})`;
  }

  propsExpr(tag, attrs, outlet, actions, isComponent) {
    const entries = [];

    // Scope every DOM element so the scoped CSS can match it. Components are
    // not scoped — their own file styles their own markup — and neither is
    // <style>, which renders nothing.
    const scope =
        !isComponent && tag.toLowerCase() !== "style" && this.scope ? this.scope : null;
    let scoped = false;

    for (const a of attrs) {
      // Markup says `styleName`; the DOM wants `class`. Components keep the
      // name they were given — their props are not DOM attributes.
      const isClass = a.name === STYLE_NAME_ATTR && !isComponent;
      const key = isClass ? "class" : a.name;
      // The scope is a class, so it joins the ones already there rather than
      // sitting in a prop of its own.
      const withScope = isClass && scope !== null;

      let value;
      if (a.value.kind === "empty") {
        value = "true";
      } else if (a.value.kind === "static") {
        value = jsString(withScope ? `${a.value.text} ${scope}`.trim() : a.value.text);
      } else {
        const parts = withScope
            ? [...a.value.parts, {kind: "text", text: ` ${scope}`}]
            : a.value.parts;
        const items = parts.map((p) =>
          p.kind === "text" ? jsString(p.text) : `{ path: ${jsString(p.path)} }`,
        );
        value = `bindAttr(this, [${items.join(", ")}])`;
      }
      if (withScope) scoped = true;
      entries.push(`${jsKey(key)}: ${value}`);
    }

    if (scope !== null && !scoped) entries.push(`class: ${jsString(scope)}`);

    // On a DOM element `action` binds a listener; on a component it binds the
    // component's action to a method here, which the child invokes. Either way
    // the method is looked up when it fires, so it can be defined or replaced
    // after mounting.
    for (const action of actions) {
      const key = isComponent
        ? action.event === null
          ? ACTION_ATTR
          : `${action.event}Action`
        : `on${(action.event ?? "click").toLowerCase()}`;
      entries.push(`${jsKey(key)}: (...__a) => this.${action.method}(...__a)`);
    }

    // `outlet="name"` compiles to a ref that assigns the node to
    // `this.name`. Arrow functions keep `this` bound to the controller.
    if (outlet) entries.push(`ref: (__el) => { this.${outlet} = __el; }`);

    if (entries.length === 0) return "null";
    return `{ ${entries.join(", ")} }`;
  }
}
