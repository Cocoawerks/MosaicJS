// Hand-written parser for the component syntax.
//
// A file is one `<interface>` root holding markup, optionally with a `<style>`
// block beside that markup inside it. One root is what makes the file an XML
// document rather than a fragment, which is what an editor checks it as.
//
// The only template syntax is `{path}`, which binds to a property on the
// controller (`{count}` reads `this.count`). There is no expression language in
// the markup: no conditionals, no loops, no JavaScript. Behaviour is declared
// with `outlet="name"` and `action="event:method"`, and carried out by a
// controller, which is a module of its own.
//
// A `.ib.xml` file holds no JavaScript at all — a `<script>` block is an error,
// not a place to put code. What an interface needs is imported by the module beside
// it, so there is one place a component is declared and one way to find it.
//
// The AST it produces:
//   { style, markup: Node[] }
//   Node = { kind: "text", text }
//        | { kind: "bind", path, line }
//        | { kind: "message", key, line }        // `{MESSAGES.Save}`
//        | { kind: "element", line, name, attrs, outlet, actions, children }
//   Attr = { name, value: { kind: "empty" }
//                        | { kind: "static", text }
//                        | { kind: "template", parts } }
//   StrPart = { kind: "text", text } | { kind: "bind", path }
//                                    | { kind: "message", key }
//   Action  = { event, method }   // event is null for a bare method name

import {
  ACTION_ATTR,
  DEFAULT_EVENT,
  isIdent,
  isPath,
  MARKUP_EXT,
  MESSAGES_ROOT,
  OUTLET_ATTR,
  OWNER_ATTR,
  ROOT_TAG,
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
  comp.markup = unwrapRoot(trimEdges(p.parseNodes(null, comp)), comp);
  checkNames(comp.markup);
  decodeEntities(comp.markup);
  return comp;
}

/** The five XML predefines. Everything else is a numeric reference or nothing. */
const ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/**
 * `&lt;` as the `<` it stands for.
 *
 * A `.ib.xml` file is XML — that is what lets an editor check it — so the one
 * way to write a `<` in text is to escape it, and a page that wants to show a
 * tag as an example has no other. Left undecoded it reached the DOM through
 * `createTextNode`, which does not decode anything, and the page displayed the
 * escape itself.
 *
 * The five XML predefines and numeric references, and nothing else. HTML's
 * named entities — `&nbsp;`, `&mdash;` — are not XML's, and an editor
 * checking this file would already have refused them.
 *
 * What is not recognised is left exactly as written rather than refused: a
 * bare `&` in prose is ordinary — "Fish & Chips" — and has always passed
 * through, so reading one as an error now would take working pages down for a
 * character they were right to write.
 */
function decodeText(text) {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (whole, body) => {
      if (body[0] !== "#") return ENTITIES[body] ?? whole;
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/**
 * Decode every text the markup will show: text nodes, and the text around the
 * bindings in an attribute value.
 *
 * Done here, over the tree, rather than as the text is read — after
 * {@link trimEdges}, so a `&#10;` that decodes to a newline is not mistaken
 * for the whitespace a line break in the source left behind and dropped.
 *
 * Not the `<style>` block, which is read verbatim: CSS has no entities, and an
 * `&` in a selector means what it says.
 */
function decodeEntities(nodes) {
  for (const node of nodes) {
    if (node.kind === "text") {
      node.text = decodeText(node.text);
      continue;
    }
    if (node.kind !== "element") continue;
    for (const attr of node.attrs) {
      if (attr.value.kind === "static") {
        attr.value.text = decodeText(attr.value.text);
      } else if (attr.value.kind === "template") {
        for (const part of attr.value.parts) {
          if (part.kind === "text") part.text = decodeText(part.text);
        }
      }
    }
    decodeEntities(node.children);
  }
}

/**
 * Take the file's content out of its `<interface>` root.
 *
 * The root is the file's own tag rather than anything it draws, so it is taken
 * off here and never reaches codegen — what comes back is what the root held,
 * which is a list because a file may hold several elements side by side.
 *
 * A file that says nothing is left alone: a `<style>` block on its own is
 * hoisted before this runs, and so is a file of nothing but comments — the one
 * `mosaic init` writes, which has no markup in it yet.
 */
function unwrapRoot(nodes, comp = {}) {
  const content = nodes.filter(
    (node) => node.kind !== "text" || node.text.trim() !== "",
  );
  if (content.length === 0) return [];

  const [first] = content;
  if (first.kind === "element" && first.name === ROOT_TAG) {
    // `<interface owner='./path/to/Owner'>` points the interface at the object it
    // draws against, freeing it from the `FooController.js` convention. A static
    // value only — an owner is a module path resolved at compile time, not
    // something a binding computes.
    const attr = first.attrs?.find((a) => a.name === OWNER_ATTR);
    if (attr) {
      if (attr.value?.kind !== "static" || attr.value.text.trim() === "") {
        throw new ParseError(
          `\`${OWNER_ATTR}\` on <${ROOT_TAG}> is a path to an owner module, ` +
            `so it must be a plain string like ${OWNER_ATTR}="./Controller"`,
        );
      }
      comp.owner = attr.value.text.trim();
    }
  }
  if (first.kind !== "element" || first.name !== ROOT_TAG) {
    throw new ParseError(
      `an ${MARKUP_EXT} file is one <${ROOT_TAG}> and its content — ` +
        `wrap what is here in <${ROOT_TAG}>…</${ROOT_TAG}>`,
    );
  }
  if (content.length > 1) {
    throw new ParseError(
      `only comments may sit beside <${ROOT_TAG}> — everything the file draws ` +
        `belongs inside it`,
    );
  }
  return first.children;
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
            "an .ib.xml file holds markup, not JavaScript — move the <script> into a " +
              "module beside it (a owner is its default export, a component " +
              "is its own file) and the markup will find it",
          );
        }
        if (this.startsWithTag("style")) {
          this.parseStyle(comp);
          continue;
        }
        out.push(this.parseElement(comp));
        continue;
      }

      if (this.peek() === "{") {
        flush();
        const line = this.line();
        out.push(this.parseBindingNode(line));
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
   * The component's `<style>` block: the CSS scoped to it and carried into the
   * bundle (see codegen). Its body may be written inline —
   *
   *   <style> .box { padding: 8px; } </style>
   *
   * — or kept in a file beside the markup and sourced in, which is the same
   * thing said in its own file:
   *
   *   <style src="./widget.css"/>
   *
   * The file is read at compile time by whoever holds the markup's path, so its
   * text lands in `comp.style` the same as an inline block would; `src` records
   * the path for that step. A plain quoted path, not a `{binding}` — there is
   * nothing to bind against when the build runs.
   */
  parseStyle(comp) {
    if (comp.style.trim() !== "" || comp.styleSrc != null)
      throw this.err("duplicate <style> block");

    const line = this.line();
    this.expect("<");
    this.parseTagName(); // "style"

    let src = null;
    let selfClosing = false;
    for (;;) {
      this.skipWs();
      if (this.eof) throw this.err("unterminated <style> tag");
      if (this.startsWith("/>")) {
        this.pos += 2;
        selfClosing = true;
        break;
      }
      if (this.peek() === ">") {
        this.pos++;
        break;
      }
      const attr = this.parseAttr();
      if (attr.name !== "src")
        throw this.err(`<style>: unexpected attribute \`${attr.name}\``);
      if (attr.value.kind !== "static")
        throw this.err("`src` on <style> is a plain path, not a `{binding}`");
      if (attr.value.text.trim() === "")
        throw this.err("`src` on <style> is empty");
      src = attr.value.text.trim();
    }

    if (src != null) {
      // Sourced from a file: no inline CSS as well. Both an empty
      // `<style src=…></style>` and a self-closing `<style src=…/>` are fine.
      if (!selfClosing && this.readRawTo("style").trim() !== "")
        throw this.err("<style src=…> already names a file; it cannot also hold CSS");
      comp.styleSrc = src;
      comp.styleSrcLine = line;
      return;
    }

    // Inline, unless it is an empty `<style/>` that carries nothing.
    comp.style = selfClosing ? "" : this.readRawTo("style");
  }

  /**
   * Consume verbatim from the current position up to `</tag>`, returning what
   * was between — for a block whose body is not markup, like CSS. The opening
   * tag has already been read.
   */
  readRawTo(tag) {
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
        parts.push(this.parseBindingNode());
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
   * Consume `{…}` and return what was between the braces, trimmed.
   *
   * What it may be is decided by {@link Parser#parseBindingNode}: a path to
   * read off the controller, or a message to look up. The two are held to
   * different rules, so neither is applied here.
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
    const raw = this.src.slice(start, this.pos).trim();
    this.pos++; // `}`

    if (raw === "") throw this.err("empty binding `{}`");
    return raw;
  }

  /**
   * A binding, as one of the two things it may be: a path read off the
   * controller, or a message looked up by key.
   *
   * `MESSAGES` is reserved — see {@link MESSAGES_ROOT} — and everything after
   * it is the key.
   *
   * Both are names rather than text. A path is walked across an object, so it
   * is identifiers and dots: `{count}`, `{user.name}`. A message key is looked
   * up whole, but it is still a name — a short one — not the sentence it stands
   * for:
   *
   *   {MESSAGES.save}
   *   {MESSAGES.openPicture}
   *   {MESSAGES.dialog.close}
   *
   * The message each key stands for lives in `locales/default.json`, and every
   * other language beside it. Keeping the sentence out of the markup is the
   * point: a heading is `{MESSAGES.title}` however long the title is, and a
   * message with a full stop or an ellipsis in it — `Open a file…` — is a value
   * in a catalog rather than a key that has to carry the punctuation.
   */
  parseBindingNode(line) {
    const raw = this.parseBinding();
    const prefix = `${MESSAGES_ROOT}.`;

    if (!raw.startsWith(prefix)) {
      if (raw === MESSAGES_ROOT) {
        throw this.err(
          `\`{${MESSAGES_ROOT}}\` names no message — ${MESSAGES_ROOT} is ` +
            `reserved, and a binding under it is a message to look up, like ` +
            `{${MESSAGES_ROOT}.save}`,
        );
      }
      if (!isPath(raw)) {
        throw this.err(
          `\`{${raw}}\` is not a property path — bindings read a value from ` +
            `the controller, like {count} or {user.name}; compute anything ` +
            `else in a controller method`,
        );
      }
      return line === undefined
        ? { kind: "bind", path: raw }
        : { kind: "bind", path: raw, line };
    }

    const key = raw.slice(prefix.length).trim();
    if (key === "") {
      throw this.err(
        `\`{${raw}}\` names no message — say which, like {${MESSAGES_ROOT}.save}`,
      );
    }

    // A key is a name, not the sentence it stands for: one word, or a dotted
    // path of them. The message itself — spaces, punctuation, an ellipsis and
    // all — is the value in `locales/default.json` this key looks up.
    if (!isPath(key)) {
      throw this.err(
        `\`{${raw}}\` is not a message key — a key is a short name like ` +
          `{${MESSAGES_ROOT}.save} or {${MESSAGES_ROOT}.dialog.close}, and the ` +
          `message it stands for goes in locales/default.json`,
      );
    }

    return line === undefined
      ? { kind: "message", key }
      : { kind: "message", key, line };
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
