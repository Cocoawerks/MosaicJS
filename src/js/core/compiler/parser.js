// Hand-written parser for the component syntax.
//
// A file is markup, optionally containing one top-level `<style>` block.
//
// The only template syntax is `{path}`, which binds to a property on the
// controller (`{count}` reads `this.count`). There is no expression language in
// the markup: no conditionals, no loops, no JavaScript. Behaviour is declared
// with `outlet="name"` and `action="event:method"`, and carried out by a
// controller, which is a module of its own.
//
// A `.mib` file holds no JavaScript at all — a `<script>` block is an error,
// not a place to put code. What a page needs is imported by the module beside
// it, so there is one place a component is declared and one way to find it.
//
// The AST it produces:
//   { style, markup: Node[] }
//   Node = { kind: "text", text }
//        | { kind: "bind", path, line }
//        | { kind: "element", line, name, attrs, outlet, actions, children }
//   Attr = { name, value: { kind: "empty" }
//                        | { kind: "static", text }
//                        | { kind: "template", parts } }
//   StrPart = { kind: "text", text } | { kind: "bind", path }
//   Action  = { event, method }   // event is null for a bare method name

import {
  ACTION_ATTR,
  DEFAULT_EVENT,
  isIdent,
  isPath,
  OUTLET_ATTR,
  STYLE_NAME_ATTR,
} from "./js.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export class ParseError extends Error {}

export function parse(src) {
  const p = new Parser(src);
  const comp = { style: "", markup: [] };
  comp.markup = trimEdges(p.parseNodes(null, comp));
  checkNames(comp.markup);
  return comp;
}

/**
 * Outlets and actions share one namespace: the controller. An outlet that
 * collides with an action method would overwrite it with a DOM node, and a
 * repeated outlet would silently keep only the last node — both are bugs.
 */
function checkNames(markup) {
  const outlets = [];
  const methods = [];
  collectNames(markup, outlets, methods);

  outlets.forEach((name, i) => {
    if (outlets.slice(0, i).includes(name)) {
      throw new ParseError(
        `\`${OUTLET_ATTR}="${name}"\` appears more than once — outlet names must be unique`,
      );
    }
    if (methods.includes(name)) {
      throw new ParseError(
        `\`${OUTLET_ATTR}="${name}"\` collides with the \`${ACTION_ATTR}\` method of the ` +
          `same name — the node would overwrite the controller method`,
      );
    }
  });
}

function collectNames(nodes, outlets, methods) {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (node.outlet) outlets.push(node.outlet);
    for (const a of node.actions) methods.push(a.method);
    collectNames(node.children, outlets, methods);
  }
}

class Parser {
  constructor(src) {
    this.src = src;
    this.pos = 0;
  }

  get eof() {
    return this.pos >= this.src.length;
  }

  peek() {
    return this.src[this.pos] ?? "";
  }

  startsWith(s) {
    return this.src.startsWith(s, this.pos);
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
    return new ParseError(`line ${this.line()}: ${msg}`);
  }

  skipWs() {
    while (!this.eof && /\s/.test(this.peek())) this.pos++;
  }

  expect(s) {
    if (!this.startsWith(s)) throw this.err(`expected \`${s}\``);
    this.pos += s.length;
  }

  /**
   * Parse children until the closing tag `stop`, or until end of input when
   * `stop` is null.
   */
  parseNodes(stop, comp) {
    const out = [];
    let text = "";
    const flush = () => {
      if (text !== "") {
        out.push({ kind: "text", text });
        text = "";
      }
    };

    for (;;) {
      if (this.eof) {
        if (stop !== null) throw this.err(`unclosed <${stop}>`);
        flush();
        return out;
      }

      if (this.startsWith("<!--")) {
        const end = this.src.indexOf("-->", this.pos);
        this.pos = end === -1 ? this.src.length : end + 3;
        continue;
      }

      if (this.startsWith("</")) {
        flush();
        return out;
      }

      if (this.peek() === "<") {
        flush();
        if (this.startsWithTag("script")) {
          throw this.err(
            "a .mib file holds markup, not JavaScript — move the <script> into a " +
              "module beside it (a controller is its default export, a component " +
              "is its own file) and the markup will find it",
          );
        }
        if (this.startsWithTag("style")) {
          const body = this.parseRawBlock("style");
          if (comp.style.trim() !== "")
            throw this.err("duplicate <style> block");
          comp.style = body;
          continue;
        }
        out.push(this.parseElement(comp));
        continue;
      }

      if (this.peek() === "{") {
        flush();
        const line = this.line();
        out.push({ kind: "bind", path: this.parseBinding(), line });
        continue;
      }

      text += this.peek();
      this.pos++;
    }
  }

  /** Is the upcoming tag `<name>` or `<name ...>`? */
  startsWithTag(name) {
    const open = `<${name}`;
    if (!this.startsWith(open)) return false;
    const after = this.src[this.pos + open.length] ?? "";
    return after === ">" || after === "/" || /\s/.test(after);
  }

  /**
   * Consume `<tag ...> ... </tag>` verbatim, returning the body. Neither CSS
   * nor JavaScript is markup, so neither is parsed as any.
   */
  parseRawBlock(tag) {
    const gt = this.src.indexOf(">", this.pos);
    if (gt === -1) throw this.err(`unterminated <${tag}> tag`);
    this.pos = gt + 1;
    const close = `</${tag}>`;
    const end = this.src.indexOf(close, this.pos);
    if (end === -1) throw this.err(`missing ${close}`);
    const body = this.src.slice(this.pos, end);
    this.pos = end + close.length;
    return body;
  }

  /**
   * Markup names the CSS class `styleName` on every element, so `class` is
   * always a mistake — and silently accepting it would mean two ways to say
   * the same thing.
   */
  checkClassAttr(name, attrs) {
    if (attrs.some((a) => a.name === "class")) {
      throw this.err(
        `<${name}>: use \`${STYLE_NAME_ATTR}\` instead of \`class\``,
      );
    }
  }

  parseElement(comp) {
    const line = this.line();
    this.expect("<");
    const name = this.parseTagName();
    if (name === "") throw this.err("expected tag name");

    const attrs = [];
    let outlet = null;
    let actions = [];
    for (;;) {
      this.skipWs();
      if (this.eof) throw this.err(`unterminated <${name}> tag`);
      if (this.startsWith("/>")) {
        this.pos += 2;
        this.checkClassAttr(name, attrs);
        return {
          kind: "element",
          line,
          name,
          attrs,
          outlet,
          actions,
          children: [],
        };
      }
      if (this.peek() === ">") {
        this.pos++;
        this.checkClassAttr(name, attrs);
        break;
      }

      const attr = this.parseAttr();
      if (attr.name === OUTLET_ATTR) {
        if (outlet !== null)
          throw this.err(`duplicate \`${OUTLET_ATTR}\` on <${name}>`);
        outlet = this.outletName(attr);
      } else if (attr.name === ACTION_ATTR) {
        if (actions.length > 0)
          throw this.err(`duplicate \`${ACTION_ATTR}\` on <${name}>`);
        actions = this.parseActions(attr);
      } else {
        attrs.push(attr);
      }
    }

    if (VOID_ELEMENTS.has(name.toLowerCase())) {
      return {
        kind: "element",
        line,
        name,
        attrs,
        outlet,
        actions,
        children: [],
      };
    }

    const children = this.parseNodes(name, comp);
    this.expect("</");
    const close = this.parseTagName();
    if (close !== name)
      throw this.err(`expected </${name}>, found </${close}>`);
    this.skipWs();
    this.expect(">");

    return {
      kind: "element",
      line,
      name,
      attrs,
      outlet,
      actions,
      children: trimEdges(children),
    };
  }

  parseTagName() {
    const start = this.pos;
    while (!this.eof && /[\p{L}\p{N}\-_.]/u.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  parseAttr() {
    const start = this.pos;
    while (!this.eof) {
      const c = this.peek();
      if (/\s/.test(c) || c === "=" || c === ">" || c === "/") break;
      this.pos++;
    }
    if (start === this.pos)
      throw this.err(`unexpected \`${this.peek()}\` in tag`);
    const name = this.src.slice(start, this.pos);

    if (this.peek() !== "=") return { name, value: { kind: "empty" } };
    this.pos++; // `=`

    if (this.peek() === "{") {
      throw this.err(
        `\`${name}\`: put the binding inside quotes, as ${name}="{path}"`,
      );
    }

    const quote = this.peek();
    if (quote !== '"' && quote !== "'")
      throw this.err("attribute value must be quoted");
    this.pos++;

    const parts = [];
    let text = "";
    for (;;) {
      if (this.eof) throw this.err("unterminated attribute value");
      if (this.peek() === quote) {
        this.pos++;
        break;
      }
      if (this.peek() === "{") {
        if (text !== "") {
          parts.push({ kind: "text", text });
          text = "";
        }
        parts.push({ kind: "bind", path: this.parseBinding() });
        continue;
      }
      text += this.peek();
      this.pos++;
    }
    if (text !== "") parts.push({ kind: "text", text });

    // A value with no bindings stays a plain string.
    let value;
    if (parts.length === 0) value = { kind: "static", text: "" };
    else if (parts.length === 1 && parts[0].kind === "text")
      value = { kind: "static", text: parts[0].text };
    else value = { kind: "template", parts };

    return { name, value };
  }

  /**
   * Consume `{path}`. The contents must be a dotted property path — this is
   * a binding to the controller, not an expression language.
   */
  parseBinding() {
    this.expect("{");
    const start = this.pos;
    while (!this.eof && this.peek() !== "}") {
      if (this.peek() === "{" || this.peek() === "<") break;
      this.pos++;
    }
    if (this.eof || this.peek() !== "}")
      throw this.err("unterminated `{` — expected `}`");
    const path = this.src.slice(start, this.pos).trim();
    this.pos++; // `}`

    if (path === "") throw this.err("empty binding `{}`");
    if (!isPath(path)) {
      throw this.err(
        `\`{${path}}\` is not a property path — bindings read a value from the ` +
          `controller, like {count} or {user.name}; compute anything else ` +
          `in a controller method`,
      );
    }
    return path;
  }

  /**
   * `outlet` names a property on the controller, so it must be a plain
   * identifier.
   */
  outletName(attr) {
    if (attr.value.kind === "static" && isIdent(attr.value.text.trim())) {
      return attr.value.text.trim();
    }
    throw this.err(`\`${OUTLET_ATTR}\` must be a quoted identifier`);
  }

  /**
   * `action="increment"`, `action="input:onInput"`, or several
   * whitespace-separated pairs.
   */
  parseActions(attr) {
    if (attr.value.kind !== "static") {
      throw this.err(`\`${ACTION_ATTR}\` must be a quoted string`);
    }

    const out = [];
    for (const part of attr.value.text.split(/\s+/).filter(Boolean)) {
      const colon = part.indexOf(":");
      const event = colon === -1 ? null : part.slice(0, colon).trim();
      const method = colon === -1 ? part.trim() : part.slice(colon + 1).trim();

      if (!isIdent(method)) {
        throw this.err(
          `\`${ACTION_ATTR}\`: \`${method}\` is not a valid controller method name`,
        );
      }
      if (event !== null && !/^[\p{L}\p{N}-]+$/u.test(event)) {
        throw this.err(
          `\`${ACTION_ATTR}\`: \`${event}\` is not a valid event name`,
        );
      }
      const key = event ?? DEFAULT_EVENT;
      if (out.some((a) => (a.event ?? DEFAULT_EVENT) === key)) {
        throw this.err(
          `\`${ACTION_ATTR}\`: \`${key}\` is bound twice on the same element`,
        );
      }
      out.push({ event, method });
    }

    if (out.length === 0) throw this.err(`\`${ACTION_ATTR}\` is empty`);
    return out;
  }
}

/**
 * Drop whitespace-only text nodes that came from source formatting, and trim
 * the edges of a child list.
 */
function trimEdges(nodes) {
  const out = nodes.filter(
    (n) =>
      !(n.kind === "text" && n.text.trim() === "" && n.text.includes("\n")),
  );
  if (out.length > 0 && out[0].kind === "text") {
    out[0] = { kind: "text", text: out[0].text.trimStart() };
  }
  const last = out.length - 1;
  if (last >= 0 && out[last].kind === "text") {
    out[last] = { kind: "text", text: out[last].text.trimEnd() };
  }
  return out.filter((n) => !(n.kind === "text" && n.text === ""));
}
