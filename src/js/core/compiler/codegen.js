// Emits an ES module that builds the component's markup with `h()` calls.

import * as css from "./css.js";
import {
  ACTION_ATTR,
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
  if (usesAttrBinding(comp.markup)) imports.push("bindAttr");
  if (hasStyle) imports.push("addStyles");

  let out = `import { ${imports.join(", ")} } from ${jsString(opts.runtime)};\n\n`;

  // Every capitalised tag is another compiled module. Where it lands is the
  // caller's business — a component library compiles somewhere of its own, so
  // assuming a sibling would emit an import that resolves to nothing.
  //
  // A `.mib` file declares nothing itself, so every tag in it is another
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
      css.scope(comp.style, `.${scope}`, null, { minify: opts.minify }),
    )};\n`;
    out += `addStyles(${jsString(opts.hash)}, ${cssVar});\n\n`;
  }

  // `props` carries initial values only — it is forwarded to child components
  // and is otherwise the controller's business. There is no reactivity.
  // A page's own controller, written beside it: `Foo.mib` is paired with the
  // `FooController.js` next to it. The runtime builds one per drawn instance
  // and calls the page against it, so the bindings, outlets and actions in
  // this markup are that controller's rather than the page's above it.
  if (opts.controller) {
    out += `import ${opts.name}Controller from ${jsString(opts.controller)};\n\n`;
  }

  out += `export default function ${opts.name}(props = {}) {\n`;
  const ctx = new Ctx(hasStyle ? scope : null);
  out += `  return ${ctx.childrenExpr(comp.markup, 1)};\n}\n`;
  if (opts.controller) {
    out += `\n${opts.name}.controller = ${opts.name}Controller;\n`;
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

/** Does the tree contain `{path}` inside an attribute value? */
function usesAttrBinding(nodes) {
  return nodes.some(
    (n) =>
      n.kind === "element" &&
      (n.attrs.some((a) => a.value.kind === "template") ||
        usesAttrBinding(n.children)),
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
      !isComponent && tag.toLowerCase() !== "style" && this.scope
        ? this.scope
        : null;
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
        value = jsString(
          withScope ? `${a.value.text} ${scope}`.trim() : a.value.text,
        );
      } else {
        // A binding keeps an attribute of *this* markup up to date. A
        // component is not markup: what it does with `enabled` is its own,
        // and there is nothing to rewrite when the value changes.
        if (isComponent) {
          throw new Error(
            `<${tag} ${a.name}="{...}"/>: a component's props are not bound. ` +
              `Give it \`${OUTLET_ATTR}="name"\` and set ${a.name} on it from the controller.`,
          );
        }
        const parts = withScope
          ? [...a.value.parts, { kind: "text", text: ` ${scope}` }]
          : a.value.parts;
        const items = parts.map((p) =>
          p.kind === "text"
            ? jsString(p.text)
            : `{ path: ${jsString(p.path)} }`,
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
