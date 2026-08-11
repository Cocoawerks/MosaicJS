//! Emits an ES module that builds the component's markup with `h()` calls.

use crate::ast::*;
use crate::css;

pub struct Options {
    /// Import specifier for the runtime module.
    pub runtime: String,
    /// Exported component name.
    pub name: String,
    /// Scope hash, derived from the source.
    pub hash: String,
}

pub fn generate(comp: &Component, opts: &Options) -> String {
    let scope_attr = format!("data-mosaic-{}", opts.hash);
    let has_style = !comp.style.trim().is_empty();

    let mut imports = vec!["h", "Fragment"];
    if uses_text_binding(&comp.markup) {
        imports.push("bindText");
    }
    if uses_attr_binding(&comp.markup) {
        imports.push("bindAttr");
    }
    if has_style {
        imports.push("addStyles");
    }

    let mut out = String::new();
    out.push_str(&format!(
        "import {{ {} }} from {};\n\n",
        imports.join(", "),
        js_string(&opts.runtime)
    ));

    // Every capitalised tag is another compiled module, imported by name from
    // alongside this one.
    for name in component_tags(&comp.markup) {
        out.push_str(&format!(
            "import {} from {};\n",
            name,
            js_string(&format!("./{}.js", name))
        ));
    }
    if !component_tags(&comp.markup).is_empty() {
        out.push('\n');
    }

    if has_style {
        // Namespaced by component: bundling puts every module in one scope,
        // where a bare `CSS` would collide.
        let css_var = format!("CSS_{}", opts.name);
        let scoped = css::scope(&comp.style, &scope_attr);
        out.push_str(&format!("const {} = {};\n", css_var, js_string(&scoped)));
        out.push_str(&format!(
            "addStyles({}, {});\n\n",
            js_string(&opts.hash),
            css_var
        ));
    }

    // `props` carries initial values only — it is forwarded to child components
    // and is otherwise the controller's business. There is no reactivity.
    out.push_str(&format!(
        "export default function {}(props = {{}}) {{\n",
        opts.name
    ));

    let ctx = Ctx {
        scope_attr: if has_style { Some(scope_attr) } else { None },
    };
    let body = ctx.children_expr(&comp.markup, 1);
    out.push_str(&format!("  return {};\n}}\n", body));
    out
}

/// Components referenced by the markup, deduplicated and in source order.
/// `<View>` is built in, and a dotted tag imports its namespace root.
fn component_tags(nodes: &[Node]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    collect_component_tags(nodes, &mut out);
    out
}

fn collect_component_tags(nodes: &[Node], out: &mut Vec<String>) {
    for node in nodes {
        let Node::Element { name, children, .. } = node else {
            continue;
        };
        let is_component =
            name.chars().next().is_some_and(|c| c.is_uppercase()) || name.contains('.');
        if is_component && name != VIEW_TAG {
            let root = name.split('.').next().unwrap_or(name).to_string();
            if !out.contains(&root) {
                out.push(root);
            }
        }
        collect_component_tags(children, out);
    }
}

/// Does the tree contain `{path}` in text?
fn uses_text_binding(nodes: &[Node]) -> bool {
    nodes.iter().any(|n| match n {
        Node::Bind(..) => true,
        Node::Element { children, .. } => uses_text_binding(children),
        Node::Text(_) => false,
    })
}

/// Does the tree contain `{path}` inside an attribute value?
fn uses_attr_binding(nodes: &[Node]) -> bool {
    nodes.iter().any(|n| match n {
        Node::Element { attrs, children, .. } => {
            attrs
                .iter()
                .any(|a| matches!(a.value, AttrValue::Template(_)))
                || uses_attr_binding(children)
        }
        _ => false,
    })
}

/// The built-in view element.
pub const VIEW_TAG: &str = "View";
/// How markup names the CSS class, on every element — never `class`.
pub const STYLE_NAME_ATTR: &str = "styleName";

struct Ctx {
    /// `None` when the component has no styles — no attribute is emitted then.
    scope_attr: Option<String>,
}

impl Ctx {
    /// A single JS expression for a child list: one node inline, many wrapped in
    /// a Fragment so a component always returns one vnode.
    fn children_expr(&self, nodes: &[Node], indent: usize) -> String {
        match nodes.len() {
            0 => "null".to_string(),
            1 => self.node_expr(&nodes[0], indent),
            _ => {
                let pad = "  ".repeat(indent + 1);
                let items: Vec<String> = nodes
                    .iter()
                    .map(|n| format!("{}{}", pad, self.node_expr(n, indent + 1)))
                    .collect();
                format!(
                    "h(Fragment, null,\n{}\n{})",
                    items.join(",\n"),
                    "  ".repeat(indent)
                )
            }
        }
    }

    fn node_expr(&self, node: &Node, indent: usize) -> String {
        match node {
            Node::Text(t) => js_string(t),
            // The runtime creates the text node and remembers it, so a later
            // `refresh(controller)` can re-read the path and update it.
            Node::Bind(path, line) => {
                format!("{}bindText(this, {})", line_marker(*line), js_string(path))
            }
            Node::Element {
                line,
                name,
                attrs,
                outlet,
                actions,
                children,
            } => {
                let code =
                    self.element_expr(name, attrs, outlet.as_deref(), actions, children, indent);
                format!("{}{}", line_marker(*line), code)
            }
        }
    }

    fn element_expr(
        &self,
        name: &str,
        attrs: &[Attr],
        outlet: Option<&str>,
        actions: &[Action],
        children: &[Node],
        indent: usize,
    ) -> String {
        // `<View styleName="counter">` is the built-in root element: a plain
        // `<div>`, styled like any other element.
        if name == VIEW_TAG {
            return self.element_expr("div", attrs, outlet, actions, children, indent);
        }

        // Capitalised (or dotted) names resolve to a component in scope.
        let tag = if name.chars().next().is_some_and(|c| c.is_uppercase()) || name.contains('.') {
            name.to_string()
        } else {
            js_string(name)
        };
        let is_component = !tag.starts_with('"');

        let props = self.props_expr(name, attrs, outlet, actions, is_component);

        if children.is_empty() {
            return format!("h({}, {})", tag, props);
        }

        let pad = "  ".repeat(indent + 1);
        let kids: Vec<String> = children
            .iter()
            .map(|c| format!("{}{}", pad, self.node_expr(c, indent + 1)))
            .collect();
        format!(
            "h({}, {},\n{}\n{})",
            tag,
            props,
            kids.join(",\n"),
            "  ".repeat(indent)
        )
    }

    fn props_expr(
        &self,
        tag: &str,
        attrs: &[Attr],
        outlet: Option<&str>,
        actions: &[Action],
        is_component: bool,
    ) -> String {
        let mut entries: Vec<String> = Vec::new();

        for a in attrs {
            // Markup says `styleName`; the DOM wants `class`. Components keep
            // the name they were given — their props are not DOM attributes.
            let key = if a.name == STYLE_NAME_ATTR && !is_component {
                "class"
            } else {
                &a.name
            };
            let value = match &a.value {
                AttrValue::Empty => "true".to_string(),
                AttrValue::Static(v) => js_string(v),
                AttrValue::Template(parts) => {
                    let items: Vec<String> = parts
                        .iter()
                        .map(|p| match p {
                            StrPart::Text(t) => js_string(t),
                            StrPart::Bind(path) => format!("{{ path: {} }}", js_string(path)),
                        })
                        .collect();
                    format!("bindAttr(this, [{}])", items.join(", "))
                }
            };
            entries.push(format!("{}: {}", js_key(key), value));
        }

        // On a DOM element `ib:action` binds a listener; on a component it binds
        // the component's action to a method here, which the child invokes.
        // Either way the method is looked up when it fires, so it can be
        // defined or replaced after mounting.
        for action in actions {
            let key = if is_component {
                match &action.event {
                    None => "action".to_string(),
                    Some(name) => format!("{}Action", name),
                }
            } else {
                format!("on{}", action.event.as_deref().unwrap_or("click").to_lowercase())
            };
            entries.push(format!(
                "{}: (...__a) => this.{}(...__a)",
                js_key(&key),
                action.method
            ));
        }

        // `ib:outlet="name"` compiles to a ref that assigns the node to
        // `this.name`. Arrow functions keep `this` bound to the controller.
        if let Some(name) = outlet {
            entries.push(format!("ref: (__el) => {{ this.{} = __el; }}", name));
        }

        // Scope every DOM element so the scoped CSS can match it. Components
        // are not scoped — their own file styles their own markup.
        if !is_component && !tag.eq_ignore_ascii_case("style") {
            if let Some(attr) = &self.scope_attr {
                entries.push(format!("{}: \"\"", js_key(attr)));
            }
        }

        if entries.is_empty() {
            return "null".to_string();
        }
        format!("{{ {} }}", entries.join(", "))
    }
}

/// A marker consumed by the source-map pass and then removed. Emitting it as a
/// comment keeps the intermediate output valid JavaScript.
pub fn line_marker(line: usize) -> String {
    format!("/*@L{}*/", line)
}

/// Strip line markers, returning the clean code and a `(output line, source
/// line)` pair for every output line whose origin is known.
pub fn take_line_markers(code: &str) -> (String, Vec<(usize, usize)>) {
    let mut out = String::with_capacity(code.len());
    let mut mappings: Vec<(usize, usize)> = Vec::new();
    let mut out_line = 1usize;

    for line in code.split_inclusive('\n') {
        let mut rest = line;
        let mut first: Option<usize> = None;
        let mut cleaned = String::with_capacity(line.len());

        while let Some(start) = rest.find("/*@L") {
            let Some(end_rel) = rest[start..].find("*/") else {
                break;
            };
            let end = start + end_rel + 2;
            let n: usize = rest[start + 4..start + end_rel].parse().unwrap_or(0);
            if first.is_none() && n > 0 {
                first = Some(n);
            }
            cleaned.push_str(&rest[..start]);
            rest = &rest[end..];
        }
        cleaned.push_str(rest);

        if let Some(src_line) = first {
            mappings.push((out_line, src_line));
        }
        out.push_str(&cleaned);
        if cleaned.ends_with('\n') {
            out_line += 1;
        }
    }
    (out, mappings)
}

fn js_key(k: &str) -> String {
    let ok = !k.is_empty()
        && k.chars()
            .next()
            .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
        && k.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$');
    if ok {
        k.to_string()
    } else {
        js_string(k)
    }
}

pub fn js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
