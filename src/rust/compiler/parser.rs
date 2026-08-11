//! Hand-written parser for the component syntax.
//!
//! A file is markup, optionally containing one top-level `<style>` block.
//!
//! The only template syntax is `{path}`, which binds to a property on the
//! controller (`{count}` reads `this.count`). There is no expression language:
//! no conditionals, no loops, no JavaScript and no `<script>`. Behaviour is
//! declared with `ib:outlet="name"` and `ib:action="event:method"`, and carried
//! out by a controller at runtime.

use crate::ast::*;

pub struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

pub type PResult<T> = Result<T, String>;

/// `ib:outlet="name"` binds the rendered node to `this.name`.
const OUTLET_ATTR: &str = "ib:outlet";
/// `ib:action="click:method"` binds listeners to `this.method`.
const ACTION_ATTR: &str = "ib:action";
/// Event assumed when an action names only a method.
const DEFAULT_EVENT: &str = "click";

const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

pub fn parse(src: &str) -> PResult<Component> {
    let mut p = Parser {
        src: src.as_bytes(),
        pos: 0,
    };
    let mut comp = Component::default();
    let nodes = p.parse_nodes(None, &mut comp)?;
    comp.markup = trim_edges(nodes);
    check_names(&comp.markup)?;
    Ok(comp)
}

/// Outlets and actions share one namespace: the controller. An outlet that
/// collides with an action method would overwrite it with a DOM node, and a
/// repeated outlet would silently keep only the last node — both are bugs.
fn check_names(markup: &[Node]) -> PResult<()> {
    let mut outlets: Vec<&str> = Vec::new();
    let mut methods: Vec<&str> = Vec::new();
    collect_names(markup, &mut outlets, &mut methods);

    for (i, name) in outlets.iter().enumerate() {
        if outlets[..i].contains(name) {
            return Err(format!(
                "`{}=\"{}\"` appears more than once — outlet names must be unique",
                OUTLET_ATTR, name
            ));
        }
        if methods.contains(name) {
            return Err(format!(
                "`{}=\"{}\"` collides with the `{}` method of the same name — \
                 the node would overwrite the controller method",
                OUTLET_ATTR, name, ACTION_ATTR
            ));
        }
    }
    Ok(())
}

fn collect_names<'a>(nodes: &'a [Node], outlets: &mut Vec<&'a str>, methods: &mut Vec<&'a str>) {
    for node in nodes {
        let Node::Element {
            outlet,
            actions,
            children,
            ..
        } = node
        else {
            continue;
        };
        if let Some(name) = outlet {
            outlets.push(name);
        }
        methods.extend(actions.iter().map(|a| a.method.as_str()));
        collect_names(children, outlets, methods);
    }
}

impl<'a> Parser<'a> {
    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn peek(&self) -> u8 {
        if self.eof() {
            0
        } else {
            self.src[self.pos]
        }
    }

    fn starts_with(&self, s: &str) -> bool {
        self.src[self.pos.min(self.src.len())..].starts_with(s.as_bytes())
    }

    fn rest(&self) -> &str {
        std::str::from_utf8(&self.src[self.pos.min(self.src.len())..]).unwrap_or("")
    }

    fn line(&self) -> usize {
        self.src[..self.pos].iter().filter(|&&c| c == b'\n').count() + 1
    }

    fn err<T>(&self, msg: &str) -> PResult<T> {
        Err(format!("line {}: {}", self.line(), msg))
    }

    fn skip_ws(&mut self) {
        while !self.eof() && self.peek().is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn expect(&mut self, s: &str) -> PResult<()> {
        if self.starts_with(s) {
            self.pos += s.len();
            Ok(())
        } else {
            self.err(&format!("expected `{}`", s))
        }
    }

    /// Parse children until the closing tag `stop`, or until end of input when
    /// `stop` is `None`.
    fn parse_nodes(&mut self, stop: Option<&str>, comp: &mut Component) -> PResult<Vec<Node>> {
        let mut out = Vec::new();
        let mut text = String::new();

        macro_rules! flush {
            () => {
                if !text.is_empty() {
                    out.push(Node::Text(std::mem::take(&mut text)));
                }
            };
        }

        loop {
            if self.eof() {
                if let Some(tag) = stop {
                    return self.err(&format!("unclosed <{}>", tag));
                }
                flush!();
                return Ok(out);
            }

            if self.starts_with("<!--") {
                let end = self.rest().find("-->").map(|i| self.pos + i + 3);
                self.pos = end.unwrap_or(self.src.len());
                continue;
            }

            if self.starts_with("</") {
                flush!();
                return Ok(out);
            }

            if self.peek() == b'<' {
                flush!();
                if self.starts_with_tag("script") {
                    return self.err(
                        "<script> is not supported — put behaviour in a controller and \
                         reach the DOM with ib:outlet",
                    );
                }
                if self.starts_with_tag("style") {
                    let body = self.parse_style_block()?;
                    if !comp.style.trim().is_empty() {
                        return self.err("duplicate <style> block");
                    }
                    comp.style = body;
                    continue;
                }
                out.push(self.parse_element(comp)?);
                continue;
            }

            if self.peek() == b'{' {
                flush!();
                let line = self.line();
                out.push(Node::Bind(self.parse_binding()?, line));
                continue;
            }

            text.push(self.peek() as char);
            self.pos += 1;
        }
    }

    /// Is the upcoming tag `<name>` or `<name ...>`?
    fn starts_with_tag(&self, name: &str) -> bool {
        let open = format!("<{}", name);
        if !self.starts_with(&open) {
            return false;
        }
        let after = *self.src.get(self.pos + open.len()).unwrap_or(&0);
        matches!(after, b'>' | b' ' | b'\n' | b'\t' | b'\r' | b'/')
    }

    /// Consume `<style ...> ... </style>` verbatim, returning the body.
    fn parse_style_block(&mut self) -> PResult<String> {
        let Some(gt) = self.rest().find('>') else {
            return self.err("unterminated <style> tag");
        };
        self.pos += gt + 1;
        let Some(end) = self.rest().find("</style>") else {
            return self.err("missing </style>");
        };
        let body = self.rest()[..end].to_string();
        self.pos += end + "</style>".len();
        Ok(body)
    }

    /// Markup names the CSS class `styleName` on every element, so `class` is
    /// always a mistake — and silently accepting it would mean two ways to say
    /// the same thing.
    fn check_class_attr(&self, name: &str, attrs: &[Attr]) -> PResult<()> {
        if attrs.iter().any(|a| a.name == "class") {
            return self.err(&format!(
                "<{}>: use `{}` instead of `class`",
                name,
                crate::codegen::STYLE_NAME_ATTR
            ));
        }
        Ok(())
    }

    fn parse_element(&mut self, comp: &mut Component) -> PResult<Node> {
        let line = self.line();
        self.expect("<")?;
        let name = self.parse_tag_name()?;
        if name.is_empty() {
            return self.err("expected tag name");
        }

        let mut attrs = Vec::new();
        let mut outlet = None;
        let mut actions = Vec::new();
        loop {
            self.skip_ws();
            if self.eof() {
                return self.err(&format!("unterminated <{}> tag", name));
            }
            if self.starts_with("/>") {
                self.pos += 2;
                self.check_class_attr(&name, &attrs)?;
                return Ok(Node::Element {
                    line,
                    name,
                    attrs,
                    outlet,
                    actions,
                    children: Vec::new(),
                });
            }
            if self.peek() == b'>' {
                self.pos += 1;
                self.check_class_attr(&name, &attrs)?;
                break;
            }

            let attr = self.parse_attr()?;
            match attr.name.as_str() {
                OUTLET_ATTR => {
                    if outlet.is_some() {
                        return self.err(&format!("duplicate `{}` on <{}>", OUTLET_ATTR, name));
                    }
                    outlet = Some(self.outlet_name(&attr)?);
                }
                ACTION_ATTR => {
                    if !actions.is_empty() {
                        return self.err(&format!("duplicate `{}` on <{}>", ACTION_ATTR, name));
                    }
                    actions = self.actions(&attr)?;
                }
                _ => attrs.push(attr),
            }
        }

        if VOID_ELEMENTS.contains(&name.to_ascii_lowercase().as_str()) {
            return Ok(Node::Element {
                line,
                name,
                attrs,
                outlet,
                actions,
                children: Vec::new(),
            });
        }

        let children = self.parse_nodes(Some(&name), comp)?;
        self.expect("</")?;
        let close = self.parse_tag_name()?;
        if close != name {
            return self.err(&format!("expected </{}>, found </{}>", name, close));
        }
        self.skip_ws();
        self.expect(">")?;

        Ok(Node::Element {
            line,
            name,
            attrs,
            outlet,
            actions,
            children: trim_edges(children),
        })
    }

    fn parse_tag_name(&mut self) -> PResult<String> {
        let start = self.pos;
        while !self.eof() {
            let c = self.peek();
            if c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.' {
                self.pos += 1;
            } else {
                break;
            }
        }
        Ok(String::from_utf8_lossy(&self.src[start..self.pos]).into_owned())
    }

    fn parse_attr(&mut self) -> PResult<Attr> {
        let start = self.pos;
        while !self.eof() {
            let c = self.peek();
            if c.is_ascii_whitespace() || c == b'=' || c == b'>' || c == b'/' {
                break;
            }
            self.pos += 1;
        }
        if start == self.pos {
            return self.err(&format!("unexpected `{}` in tag", self.peek() as char));
        }
        let name = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();

        if self.peek() != b'=' {
            return Ok(Attr {
                name,
                value: AttrValue::Empty,
            });
        }
        self.pos += 1; // `=`

        if self.peek() == b'{' {
            return self.err(&format!(
                "`{}`: put the binding inside quotes, as {}=\"{{path}}\"",
                name, name
            ));
        }

        let quote = self.peek();
        if quote != b'"' && quote != b'\'' {
            return self.err("attribute value must be quoted");
        }
        self.pos += 1;

        let mut parts: Vec<StrPart> = Vec::new();
        let mut text = String::new();
        loop {
            if self.eof() {
                return self.err("unterminated attribute value");
            }
            if self.peek() == quote {
                self.pos += 1;
                break;
            }
            if self.peek() == b'{' {
                if !text.is_empty() {
                    parts.push(StrPart::Text(std::mem::take(&mut text)));
                }
                parts.push(StrPart::Bind(self.parse_binding()?));
                continue;
            }
            text.push(self.peek() as char);
            self.pos += 1;
        }
        if !text.is_empty() {
            parts.push(StrPart::Text(text));
        }

        // A value with no bindings stays a plain string.
        let value = match parts.as_slice() {
            [] => AttrValue::Static(String::new()),
            [StrPart::Text(t)] => AttrValue::Static(t.clone()),
            _ => AttrValue::Template(parts),
        };
        Ok(Attr { name, value })
    }

    /// Consume `{path}`. The contents must be a dotted property path — this is
    /// a binding to the controller, not an expression language.
    fn parse_binding(&mut self) -> PResult<String> {
        self.expect("{")?;
        let start = self.pos;
        while !self.eof() && self.peek() != b'}' {
            if self.peek() == b'{' || self.peek() == b'<' {
                break;
            }
            self.pos += 1;
        }
        if self.eof() || self.peek() != b'}' {
            return self.err("unterminated `{` — expected `}`");
        }
        let path = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        let path = path.trim().to_string();
        self.pos += 1; // `}`

        if path.is_empty() {
            return self.err("empty binding `{}`");
        }
        if !is_path(&path) {
            return self.err(&format!(
                "`{{{}}}` is not a property path — bindings read a value from the \
                 controller, like {{count}} or {{user.name}}; compute anything else \
                 in a controller method",
                path
            ));
        }
        Ok(path)
    }

    /// `ib:outlet` names a property on the controller, so it must be a plain
    /// identifier.
    fn outlet_name(&self, attr: &Attr) -> PResult<String> {
        match &attr.value {
            AttrValue::Static(v) if is_ident(v.trim()) => Ok(v.trim().to_string()),
            _ => self.err(&format!("`{}` must be a quoted identifier", OUTLET_ATTR)),
        }
    }

    /// `ib:action="increment"`, `ib:action="input:onInput"`, or several
    /// whitespace-separated pairs.
    fn actions(&self, attr: &Attr) -> PResult<Vec<Action>> {
        let AttrValue::Static(v) = &attr.value else {
            return self.err(&format!("`{}` must be a quoted string", ACTION_ATTR));
        };

        let mut out: Vec<Action> = Vec::new();
        for part in v.split_whitespace() {
            let (event, method) = match part.split_once(':') {
                Some((e, m)) => (Some(e.trim()), m.trim()),
                None => (None, part.trim()),
            };
            if !is_ident(method) {
                return self.err(&format!(
                    "`{}`: `{}` is not a valid controller method name",
                    ACTION_ATTR, method
                ));
            }
            if let Some(name) = event {
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    return self.err(&format!("`{}`: `{}` is not a valid event name", ACTION_ATTR, name));
                }
            }
            let key = event.unwrap_or(DEFAULT_EVENT);
            if out
                .iter()
                .any(|a| a.event.as_deref().unwrap_or(DEFAULT_EVENT) == key)
            {
                return self.err(&format!(
                    "`{}`: `{}` is bound twice on the same element",
                    ACTION_ATTR, key
                ));
            }
            out.push(Action {
                event: event.map(|e| e.to_string()),
                method: method.to_string(),
            });
        }

        if out.is_empty() {
            return self.err(&format!("`{}` is empty", ACTION_ATTR));
        }
        Ok(out)
    }
}

/// A dotted path of identifiers: `count`, `user.name`.
fn is_path(s: &str) -> bool {
    !s.is_empty() && s.split('.').all(is_ident)
}

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
        && s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$')
}

/// Drop whitespace-only text nodes that came from source formatting, and trim
/// the edges of a child list.
fn trim_edges(nodes: Vec<Node>) -> Vec<Node> {
    let mut nodes: Vec<Node> = nodes
        .into_iter()
        .filter(|n| match n {
            Node::Text(t) => !(t.trim().is_empty() && t.contains('\n')),
            _ => true,
        })
        .collect();
    if let Some(Node::Text(t)) = nodes.first_mut() {
        *t = t.trim_start().to_string();
    }
    if let Some(Node::Text(t)) = nodes.last_mut() {
        *t = t.trim_end().to_string();
    }
    nodes.retain(|n| !matches!(n, Node::Text(t) if t.is_empty()));
    nodes
}
