// Emits an ES module that builds the component's markup with `h()` calls.

import * as css from "./css.js";
import {
  ACTION_ATTR,
  BIND_SCOPE_PROP,
  BIND_TAG,
  jsKey,
  jsString,
  lineMarker,
  OUTLET_ATTR,
  scopeClass,
  STYLE_NAME_ATTR,
  VIEW_TAG,
} from "./js.js";

/**
 * @param comp  the parsed component
 * @param opts  { runtime, name, hash, resolve } — runtime import specifier,
 *              exported component name, the scope hash derived from the
 *              source, and a lookup for component tags: `name -> specifier`
 *              for a module imported by path, or `{specifier, named: true}`
 *              for one a package exports under its own name.
 *              `controller` is the specifier of the controller module written
 *              beside this one, when there is one.
 */
export function generate(comp, opts) {
  const scope = scopeClass(opts.hash);
  const hasStyle = comp.style.trim() !== "";

  const imports = ["h", "Fragment"];
  if (usesTextBinding(comp.markup)) imports.push("bindText");
  if (usesMessage(comp.markup)) imports.push("bindMessage");
  if (usesAttrBinding(comp.markup, false)) imports.push("bindAttr");
  if (usesAttrBinding(comp.markup, true)) imports.push("bindProp");
  if (hasStyle) imports.push("addStyles");

  let out = `import { ${imports.join(", ")} } from ${jsString(opts.runtime)};\n\n`;

  // Every capitalised tag is another compiled module. Where it lands is the
  // caller's business — a component library compiles somewhere of its own, so
  // assuming a sibling would emit an import that resolves to nothing.
  //
  // A `.ib.xml` file declares nothing itself, so every tag in it is another
  // module's: there is one place each component is written, and one import
  // that reaches it.
  const tags = componentTags(comp.markup);
  const resolve = opts.resolve ?? ((name) => `./${name}.js`);
  for (const name of tags) {
    // A module is imported for its default export; a package that publishes
    // its components under one specifier exports them by name instead.
    const target = resolve(name);
    out +=
      typeof target === "object" && target.named
        ? `import { ${name} } from ${jsString(target.specifier)};\n`
        : `import ${name} from ${jsString(target)};\n`;
  }
  if (tags.length > 0) out += "\n";

  if (hasStyle) {
    // Namespaced by component: bundling puts every module in one scope, where
    // a bare `CSS` would collide.
    const cssVar = `CSS_${opts.name}`;
    out += `const ${cssVar} = ${jsString(
      css.scope(comp.style, `.${scope}`, null, {
        minify: opts.minify,
        // `.mydialog ComboBox` — a component named where a class would go.
        component: (name) => opts.styleNames?.get(name) ?? null,
      }),
    )};\n`;
    out += `addStyles(${jsString(opts.hash)}, ${cssVar});\n\n`;
  }

  // `props` carries initial values only — it is forwarded to child components
  // and is otherwise the controller's business. There is no reactivity.
  // A page's own controller, written beside it: `Foo.ib.xml` is paired with the
  // `FooController.js` next to it. The runtime builds one per drawn instance
  // and calls the page against it, so the bindings, outlets and actions in
  // this markup are that controller's rather than the page's above it.
  if (opts.controller) {
    out += `import ${opts.name}Controller from ${jsString(opts.controller)};\n\n`;
  }

  out += `export default function ${opts.name}(props = {}) {\n`;
  const ctx = new Ctx(hasStyle ? scope : null, { minify: opts.minify });
  out += `  return ${ctx.childrenExpr(comp.markup, 1)};\n}\n`;

  // What tells the runtime this function came from a `.ib.xml` rather than being
  // a component someone wrote by hand. A view compiled from markup draws
  // against a scope of its own and takes the tag's attributes as its state; a
  // hand-written function component is the older, plainer thing and still
  // draws against the controller of whatever placed it.
  out += `\n${opts.name}.isMarkup = true;\n`;

  // And whether it has to draw itself again when its state changes, rather
  // than having its bindings brought up to date one at a time.
  //
  // Only a file with a bound prop does. A binding on this markup's own text or
  // attributes is written straight back into the DOM, which is cheap and
  // disturbs nothing; a component's prop can only be worked out by running the
  // markup again. Saying so per file means a page that never binds a prop
  // behaves exactly as it did — including the components in it that place
  // themselves by hand, which a redraw they did not ask for can unsettle.
  if (usesAttrBinding(comp.markup, true)) {
    out += `${opts.name}.redraws = true;\n`;
  }
  if (opts.controller) {
    out += `${opts.name}.controller = ${opts.name}Controller;\n`;
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
    (n) =>
      n.kind === "bind" ||
      (n.kind === "element" && usesTextBinding(n.children)),
  );
}

/**
 * Does the tree contain `{MESSAGES.Key}` in text?
 *
 * Text position only: a message inside an attribute rides along in the
 * `bindAttr` call that attribute already needed, as one more part of the value,
 * and emits no call of its own.
 */
function usesMessage(nodes) {
  return nodes.some(
    (n) =>
      n.kind === "message" ||
      (n.kind === "element" && usesMessage(n.children)),
  );
}

/**
 * Does the tree contain `{path}` inside an attribute value — on a component
 * when `onComponent` is true, and on plain markup when it is false? The two
 * compile to different calls: a component's prop is read, an element's
 * attribute is declared and kept up to date.
 */
function usesAttrBinding(nodes, onComponent) {
  return nodes.some((n) => {
    if (n.kind !== "element") return false;
    const isComponent = isUpper(n.name[0]) || n.name.includes(".");
    const here =
      isComponent === onComponent &&
      n.name !== VIEW_TAG &&
      n.attrs.some((a) => a.value.kind === "template");
    return here || usesAttrBinding(n.children, onComponent);
  });
}

class Ctx {
  /** `null` when the component has no styles — nothing is scoped then. */
  constructor(scope, opts = {}) {
    this.scope = scope;
    this.minify = opts.minify ?? false;
  }

  /**
   * A text literal. Under `--minify` the run of whitespace a line break in the
   * markup left behind becomes the single space it renders as — the markup
   * already treats that whitespace as formatting rather than content, and a
   * literal newline in the source is a literal newline the bundler carries all
   * the way into the bundle. Collapsing here is what keeps the minified bundle
   * on one line.
   */
  textString(text) {
    return jsString(this.minify ? text.replace(/\s+/g, " ") : text);
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
    if (node.kind === "text") return this.textString(node.text);
    // The runtime creates the text node and remembers it, so a later
    // `refresh(controller)` can re-read the path and update it.
    if (node.kind === "bind") {
      return `${lineMarker(node.line)}bindText(this, ${jsString(node.path)})`;
    }
    // A message takes no controller: `MESSAGES` is reserved, and what the key
    // says depends on the locale rather than on anything a controller holds.
    if (node.kind === "message") {
      return `${lineMarker(node.line)}bindMessage(${jsString(node.key)})`;
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
      !isComponent && tag.toLowerCase() !== "style" && this.scope
        ? this.scope
        : null;
    let scoped = false;

    for (const a of attrs) {
      // Markup says `styleName`; the DOM wants `class`. A component keeps the
      // name — its props are not DOM attributes — and the runtime puts what it
      // names onto whatever element the component draws itself as.
      const isStyleName = a.name === STYLE_NAME_ATTR;
      const isClass = isStyleName && !isComponent;
      const key = isClass ? "class" : a.name;
      // The scope is a class, so it joins the ones already there rather than
      // sitting in a prop of its own. A component's `styleName` carries it too:
      // the point of naming a class on a component is to reach it from the
      // sheet of the page that placed it, and that sheet is scoped.
      // An element takes the scope the element rules worked out — none for
      // `<style>`, which renders nothing. A component takes the module's,
      // since the rules above deny it one of its own.
      const classScope = isClass ? scope : this.scope;
      const withScope = isStyleName && classScope !== null;

      let value;
      if (a.value.kind === "empty") {
        value = "true";
      } else if (a.value.kind === "static") {
        value = jsString(
          withScope ? `${a.value.text} ${classScope}`.trim() : a.value.text,
        );
      } else {
        const parts = withScope
          ? [...a.value.parts, { kind: "text", text: ` ${classScope}` }]
          : a.value.parts;
        const items = parts.map((p) => {
          if (p.kind === "text") return jsString(p.text);
          // A part that names a message is looked up rather than read, which
          // is what `key` says instead of `path` — the two may sit in one
          // value: title="{MESSAGES.SavedAt} {time}".
          if (p.kind === "message") return `{ key: ${jsString(p.key)} }`;
          return `{ path: ${jsString(p.path)} }`;
        });
        // A binding keeps an attribute of *this* markup up to date, and
        // `bindAttr` declares one of those. A component's prop is not part of
        // the markup — what a Button does with `text` is the Button's own —
        // so it is read now instead, and reading it is what marks it worth
        // watching: assigning to it draws this view again, and the prop is
        // worked out afresh.
        value = isComponent
          ? `bindProp(this, [${items.join(", ")}])`
          : `bindAttr(this, [${items.join(", ")}])`;
      }
      if (withScope) scoped = true;
      entries.push(`${jsKey(key)}: ${value}`);
    }

    if (scope !== null && !scoped) entries.push(`class: ${jsString(scope)}`);

    // A `<Bind/>` is handed the scope its paths are read against, which is this
    // file's own controller — `this` in what is being written. See BIND_TAG.
    if (isComponent && tag === BIND_TAG) {
      entries.push(`${BIND_SCOPE_PROP}: this`);
    }

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
