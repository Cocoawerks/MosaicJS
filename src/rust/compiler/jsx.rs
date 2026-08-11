//! JSX transform for `.jsx` sources.
//!
//! A `.jsx` file is ordinary JavaScript that may contain JSX expressions —
//! typically inside a `View` subclass's `draw()` method. Only the JSX is
//! rewritten, into `h()` calls; every other byte is copied through untouched.
//!
//! Unlike `.ib` markup, JSX here sits inside real JavaScript, so `{...}` holds
//! an arbitrary expression rather than a property path. `styleName`,
//! `ib:outlet` and `ib:action` mean the same thing in both.

use crate::codegen::{js_string, line_marker, STYLE_NAME_ATTR, VIEW_TAG};
use crate::css;

pub type JResult<T> = Result<T, String>;

/// Transform JSX to `h()` calls. `scope` is the component's scope attribute
/// (`data-mosaic-<hash>`), stamped on every DOM element so the module's scoped CSS
/// matches it — the same contract as `.ib` markup.
pub fn transform(src: &str, scope: Option<&str>) -> JResult<String> {
    let mut p = Jsx {
        src: src.as_bytes(),
        pos: 0,
        scope: scope.map(|s| s.to_string()),
    };
    p.program()
}

struct Jsx<'a> {
    src: &'a [u8],
    pos: usize,
    scope: Option<String>,
}

impl<'a> Jsx<'a> {
    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn peek(&self) -> u8 {
        *self.src.get(self.pos).unwrap_or(&0)
    }

    fn at(&self, offset: usize) -> u8 {
        *self.src.get(self.pos + offset).unwrap_or(&0)
    }

    fn rest(&self) -> &str {
        std::str::from_utf8(&self.src[self.pos.min(self.src.len())..]).unwrap_or("")
    }

    fn line(&self) -> usize {
        self.src[..self.pos].iter().filter(|&&c| c == b'\n').count() + 1
    }

    fn err<T>(&self, msg: &str) -> JResult<T> {
        Err(format!("line {}: {}", self.line(), msg))
    }

    /// Copy JavaScript through, transforming any JSX found in expression
    /// position. Strings, template literals, comments and regexes are opaque.
    fn program(&mut self) -> JResult<String> {
        let mut out = String::new();
        // The last non-whitespace character emitted decides whether a `<` opens
        // JSX or is a comparison operator.
        let mut prev = 0u8;

        while !self.eof() {
            let c = self.peek();
            match c {
                b'"' | b'\'' | b'`' => {
                    out.push_str(&self.copy_string()?);
                    prev = b'x';
                }
                b'/' if self.at(1) == b'/' || self.at(1) == b'*' => {
                    out.push_str(&self.copy_comment());
                }
                b'<' if self.jsx_starts_here(prev) => {
                    out.push_str(&self.element()?);
                    prev = b')';
                }
                _ => {
                    out.push(c as char);
                    self.pos += 1;
                    // A marker after each newline keeps generated lines tied to
                    // the source lines they were copied from.
                    if c == b'\n' {
                        out.push_str(&line_marker(self.line()));
                    }
                    if !c.is_ascii_whitespace() {
                        prev = c;
                    }
                }
            }
        }
        Ok(out)
    }

    /// `<` opens JSX only in expression position: after `return`, an operator,
    /// or an opening bracket — never after an identifier or a closing bracket,
    /// where it means "less than".
    fn jsx_starts_here(&self, prev: u8) -> bool {
        let next = self.at(1);
        let plausible = next.is_ascii_alphabetic() || next == b'>' || next == b'_' || next == b'$';
        if !plausible {
            return false;
        }
        match prev {
            b'(' | b',' | b'=' | b'{' | b'}' | b'[' | b';' | b':' | b'?' | b'&' | b'|' | b'!'
            | b'+' | b'-' | b'*' | b'%' | b'>' | 0 => true,
            // `return <div/>` — the only keyword case that matters in practice.
            _ => {
                let before = &self.src[..self.pos];
                let trimmed = std::str::from_utf8(before).unwrap_or("").trim_end();
                trimmed.ends_with("return")
                    || trimmed.ends_with("=>")
                    || trimmed.ends_with("default")
            }
        }
    }

    fn copy_string(&mut self) -> JResult<String> {
        let quote = self.peek();
        let start = self.pos;
        self.pos += 1;
        while !self.eof() {
            let c = self.peek();
            if c == b'\\' {
                self.pos += 2;
                continue;
            }
            if c == quote {
                self.pos += 1;
                return Ok(String::from_utf8_lossy(&self.src[start..self.pos]).into_owned());
            }
            // `${ ... }` inside a template literal may contain anything.
            if quote == b'`' && c == b'$' && self.at(1) == b'{' {
                let head = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
                self.pos += 1;
                let inner = self.braced()?;
                let tail = self.copy_string_from(quote)?;
                return Ok(format!("{}${{{}}}{}", head, transform(&inner, self.scope.as_deref())?, tail));
            }
            self.pos += 1;
        }
        self.err("unterminated string literal")
    }

    /// Continue copying a template literal after an interpolation.
    fn copy_string_from(&mut self, quote: u8) -> JResult<String> {
        let start = self.pos;
        while !self.eof() {
            let c = self.peek();
            if c == b'\\' {
                self.pos += 2;
                continue;
            }
            if c == quote {
                self.pos += 1;
                return Ok(String::from_utf8_lossy(&self.src[start..self.pos]).into_owned());
            }
            if c == b'$' && self.at(1) == b'{' {
                let head = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
                self.pos += 1;
                let inner = self.braced()?;
                let tail = self.copy_string_from(quote)?;
                return Ok(format!("{}${{{}}}{}", head, transform(&inner, self.scope.as_deref())?, tail));
            }
            self.pos += 1;
        }
        self.err("unterminated template literal")
    }

    fn copy_comment(&mut self) -> String {
        let start = self.pos;
        if self.at(1) == b'/' {
            while !self.eof() && self.peek() != b'\n' {
                self.pos += 1;
            }
        } else {
            self.pos += 2;
            while !self.eof() && !(self.peek() == b'*' && self.at(1) == b'/') {
                self.pos += 1;
            }
            self.pos = (self.pos + 2).min(self.src.len());
        }
        String::from_utf8_lossy(&self.src[start..self.pos]).into_owned()
    }

    /// Consume a `{ ... }` run, returning the inner source untransformed.
    fn braced(&mut self) -> JResult<String> {
        if self.peek() != b'{' {
            return self.err("expected `{`");
        }
        self.pos += 1;
        let start = self.pos;
        let mut depth = 1usize;
        while !self.eof() {
            match self.peek() {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        let inner =
                            String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
                        self.pos += 1;
                        return Ok(inner);
                    }
                }
                b'"' | b'\'' | b'`' => {
                    self.copy_string()?;
                    continue;
                }
                _ => {}
            }
            self.pos += 1;
        }
        self.err("unterminated `{`")
    }

    fn skip_ws(&mut self) {
        while !self.eof() && self.peek().is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    /// `<tag ...>children</tag>`, `<tag ... />` or a `<>fragment</>`.
    fn element(&mut self) -> JResult<String> {
        let line = self.line();
        self.pos += 1; // `<`
        let name = self.tag_name();

        let mut props: Vec<String> = Vec::new();
        let mut spreads: Vec<String> = Vec::new();
        let mut self_closing = false;
        let is_component = !name.is_empty()
            && (name.chars().next().is_some_and(|c| c.is_uppercase()) || name.contains('.'))
            && name != VIEW_TAG;

        loop {
            self.skip_ws();
            if self.eof() {
                return self.err(&format!("unterminated <{}> tag", name));
            }
            if self.rest().starts_with("/>") {
                self.pos += 2;
                self_closing = true;
                break;
            }
            if self.peek() == b'>' {
                self.pos += 1;
                break;
            }
            if self.peek() == b'{' {
                let inner = self.braced()?;
                let inner = inner.trim();
                let Some(obj) = inner.strip_prefix("...") else {
                    return self.err("expected {...spread} in tag");
                };
                spreads.push(transform(obj.trim(), self.scope.as_deref())?);
                continue;
            }
            for (key, value) in self.attribute(is_component)? {
                props.push(format!("{}: {}", key, value));
            }
        }

        // A DOM element carries the module's scope attribute; components style
        // their own markup, and a fragment is not an element at all.
        if !is_component && !name.is_empty() {
            if let Some(scope) = &self.scope {
                props.push(format!("{}: \"\"", js_string(scope)));
            }
        }

        let children = if self_closing {
            Vec::new()
        } else {
            self.children(&name)?
        };

        // `<View>` is the built-in root element, a plain <div>.
        let tag = if name.is_empty() {
            "Fragment".to_string()
        } else if name == VIEW_TAG {
            js_string("div")
        } else if is_component {
            name.clone()
        } else {
            js_string(&name)
        };

        let props_expr = if spreads.is_empty() {
            if props.is_empty() {
                "null".to_string()
            } else {
                format!("{{ {} }}", props.join(", "))
            }
        } else {
            let mut parts: Vec<String> = spreads.iter().map(|s| format!("({})", s)).collect();
            if !props.is_empty() {
                parts.push(format!("{{ {} }}", props.join(", ")));
            }
            format!("Object.assign({{}}, {})", parts.join(", "))
        };

        if children.is_empty() {
            return Ok(format!("{}h({}, {})", line_marker(line), tag, props_expr));
        }
        Ok(format!(
            "{}h({}, {}, {})",
            line_marker(line),
            tag,
            props_expr,
            children.join(", ")
        ))
    }

    fn tag_name(&mut self) -> String {
        let start = self.pos;
        while !self.eof() {
            let c = self.peek();
            if c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.' || c == b'$' {
                self.pos += 1;
            } else {
                break;
            }
        }
        String::from_utf8_lossy(&self.src[start..self.pos]).into_owned()
    }

    /// One attribute, returning the props it emits. `ib:action` may name
    /// several `event:method` pairs and so yields one prop per pair.
    fn attribute(&mut self, is_component: bool) -> JResult<Vec<(String, String)>> {
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
        let is_directive = name == "ib:outlet" || name == "ib:action";

        if name == "class" {
            return self.err(&format!("use `{}` instead of `class`", STYLE_NAME_ATTR));
        }

        // No `=`: a boolean attribute. Directives always need a value.
        if self.peek() != b'=' {
            if is_directive {
                return self.err(&format!("`{}` needs a value", name));
            }
            return Ok(vec![(js_key(&attr_key(&name, is_component)), "true".to_string())]);
        }
        self.pos += 1;

        if self.peek() == b'{' {
            let expr = self.braced()?;
            if is_directive {
                return self.err(&format!("`{}` takes a quoted string, not {{...}}", name));
            }
            return Ok(vec![(
                js_key(&attr_key(&name, is_component)),
                format!("({})", transform(expr.trim(), self.scope.as_deref())?),
            )]);
        }

        let value = self.quoted_value(&name)?;
        if is_directive {
            return self.directive(&name, &value, is_component);
        }
        Ok(vec![(js_key(&attr_key(&name, is_component)), js_string(&value))])
    }

    /// A quoted attribute value; the `=` has already been consumed.
    fn quoted_value(&mut self, name: &str) -> JResult<String> {
        let quote = self.peek();
        if quote != b'"' && quote != b'\'' {
            return self.err(&format!("`{}` must be a quoted string or {{expression}}", name));
        }
        self.pos += 1;
        let start = self.pos;
        while !self.eof() && self.peek() != quote {
            self.pos += 1;
        }
        if self.eof() {
            return self.err("unterminated attribute value");
        }
        let value = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        self.pos += 1;
        Ok(value)
    }

    fn directive(&self, name: &str, value: &str, is_component: bool) -> JResult<Vec<(String, String)>> {
        let value = value.trim();
        if name == "ib:outlet" {
            if !is_ident(value) {
                return self.err("`ib:outlet` must be an identifier");
            }
            return Ok(vec![(
                "ref".to_string(),
                format!("(__el) => {{ this.{} = __el; }}", value),
            )]);
        }

        // `ib:action="pointerdown:onDown keyup:onUp"` — whitespace-separated
        // `event:method` pairs. On a DOM element a bare method means click; on
        // a component it means the component's own action.
        let mut out: Vec<(String, String)> = Vec::new();
        for part in value.split_whitespace() {
            let (event, method) = match part.split_once(':') {
                Some((e, m)) => (Some(e.trim()), m.trim()),
                None => (None, part),
            };
            if !is_ident(method) {
                return self.err(&format!("`ib:action`: `{}` is not a method name", method));
            }
            let key = if is_component {
                match event {
                    None => "action".to_string(),
                    Some(name) => format!("{}Action", name),
                }
            } else {
                format!("on{}", event.unwrap_or("click").to_lowercase())
            };
            if out.iter().any(|(k, _)| *k == key) {
                return self.err(&format!("`ib:action`: `{}` is bound twice", key));
            }
            out.push((js_key(&key), format!("(...__a) => this.{}(...__a)", method)));
        }
        if out.is_empty() {
            return self.err("`ib:action` is empty");
        }
        Ok(out)
    }

    /// Children up to the matching close tag.
    fn children(&mut self, name: &str) -> JResult<Vec<String>> {
        let mut out: Vec<String> = Vec::new();
        let mut text = String::new();

        loop {
            if self.eof() {
                return self.err(&format!("unclosed <{}>", name));
            }

            if self.rest().starts_with("</") {
                push_text(&mut out, &mut text);
                self.pos += 2;
                let close = self.tag_name();
                self.skip_ws();
                if self.peek() != b'>' {
                    return self.err(&format!("malformed </{}>", close));
                }
                self.pos += 1;
                if close != name {
                    return self.err(&format!("expected </{}>, found </{}>", name, close));
                }
                return Ok(out);
            }

            if self.peek() == b'<' {
                push_text(&mut out, &mut text);
                out.push(self.element()?);
                continue;
            }

            if self.peek() == b'{' {
                push_text(&mut out, &mut text);
                let expr = self.braced()?;
                let expr = expr.trim();
                if !expr.is_empty() {
                    out.push(format!("({})", transform(expr, self.scope.as_deref())?));
                }
                continue;
            }

            text.push(self.peek() as char);
            self.pos += 1;
        }
    }
}

/// Flush pending text, dropping whitespace that is only source formatting.
fn push_text(out: &mut Vec<String>, text: &mut String) {
    let raw = std::mem::take(text);
    if raw.trim().is_empty() {
        return;
    }
    // Collapse the indentation around a newline, as JSX does.
    let collapsed = raw
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut value = collapsed;
    if raw.starts_with(char::is_whitespace) && !raw.starts_with('\n') {
        value.insert(0, ' ');
    }
    if raw.ends_with(char::is_whitespace) && !raw.ends_with('\n') {
        value.push(' ');
    }
    out.push(js_string(&value));
}

/// Markup says `styleName`; the DOM wants `class`. Component props keep the
/// name they were written with.
fn attr_key(name: &str, is_component: bool) -> String {
    if name == STYLE_NAME_ATTR && !is_component {
        "class".to_string()
    } else {
        name.to_string()
    }
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

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .next()
            .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
        && s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$')
}

/// Replace side-effect CSS imports with a runtime `addStyles` call, so
/// `import "./counter.css";` works in a browser with no bundler. The stylesheet
/// is inlined and scoped to this module at compile time, exactly as a `.ib`
/// file's `<style>` block is; `:global(...)` opts out.
pub fn inline_css_imports(
    code: &str,
    dir: &std::path::Path,
    scope: Option<&str>,
) -> JResult<(String, bool)> {
    let mut out = String::new();
    let mut found = false;

    for line in code.split_inclusive('\n') {
        // The line may carry source-map markers by now; judge it without them.
        let (clean, _) = crate::codegen::take_line_markers(line);
        let trimmed = clean.trim();
        let is_css_import = trimmed.starts_with("import ")
            && !trimmed.contains(" from ")
            && (trimmed.contains(".css\"") || trimmed.contains(".css'"));

        if !is_css_import {
            out.push_str(line);
            continue;
        }

        let spec = trimmed
            .trim_start_matches("import")
            .trim()
            .trim_end_matches(';')
            .trim()
            .trim_matches(|c| c == '"' || c == '\'');
        let path = dir.join(spec);
        let css = std::fs::read_to_string(&path)
            .map_err(|e| format!("{}: {}", path.display(), e))?;
        let css = match scope {
            Some(attr) => css::scope(&css, attr),
            None => css,
        };

        let key = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "styles".into());

        // Keep any leading marker so the statement still maps to its source line.
        let marker_end = line.rfind("*/").map(|i| i + 2).unwrap_or(0);
        out.push_str(&line[..marker_end]);
        out.push_str(&format!(
            "addStyles({}, {});",
            js_string(&key),
            js_string(css.trim_end())
        ));
        if line.ends_with('\n') {
            out.push('\n');
        }
        found = true;
    }

    Ok((out, found))
}

/// Make sure the runtime names a compiled file needs are in scope: merge them
/// into an existing import from the runtime, or prepend one. Without this, a
/// `.js` source that only imports `View` would reference an undefined `h`.
pub fn ensure_runtime_names(code: &str, runtime: &str, needed: &[&str]) -> String {

    // An existing `import { ... } from "<runtime>";` gets the missing names.
    if let Some(stmt) = find_runtime_import(code, runtime) {
        let (start, end, names_start, names_end) = stmt;
        let names = &code[names_start..names_end];
        let mut have: Vec<&str> = names
            .split(',')
            .map(|n| n.trim())
            .filter(|n| !n.is_empty())
            .collect();
        let missing: Vec<&str> = needed
            .iter()
            .copied()
            .filter(|n| !have.iter().any(|h| h == n || h.ends_with(&format!(" {}", n))))
            .collect();
        if missing.is_empty() {
            return code.to_string();
        }
        let mut names_out = missing;
        names_out.append(&mut have);
        let merged = format!(
            "import {{ {} }} from {};",
            names_out.join(", "),
            js_string(runtime)
        );
        return format!("{}{}{}", &code[..start], merged, &code[end..]);
    }

    format!(
        "import {{ {} }} from {};\n{}",
        needed.join(", "),
        js_string(runtime),
        code
    )
}

/// Locate the module's own import of the runtime — matched on file name, not on
/// the exact specifier, because a source's relative path to mosaic.js is
/// written for where the *source* lives, while the compiled file may land
/// somewhere else. The specifier is rewritten to `--runtime` either way.
fn find_runtime_import(code: &str, runtime: &str) -> Option<(usize, usize, usize, usize)> {
    let file = runtime.rsplit('/').next().unwrap_or(runtime);
    let mut search = 0;
    while let Some(rel) = code[search..].find("import") {
        let start = search + rel;
        let after = &code[start + "import".len()..];
        let Some(open_rel) = after.find('{') else {
            search = start + 6;
            continue;
        };
        let names_start = start + "import".len() + open_rel + 1;
        let Some(close_rel) = code[names_start..].find('}') else {
            return None;
        };
        let names_end = names_start + close_rel;
        let tail = &code[names_end..];
        let Some(semi_rel) = tail.find(';') else {
            return None;
        };
        let end = names_end + semi_rel + 1;
        if code[names_end..end].contains(runtime) || code[names_end..end].contains(file) {
            return Some((start, end, names_start, names_end));
        }
        search = end;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_import_is_merged_into_an_existing_one() {
        let code = "import { View } from \"../mosaic.js\";\nclass A extends View {}";
        let out = ensure_runtime_names(code, "../mosaic.js", &["h", "Fragment"]);
        assert!(out.starts_with("import { h, Fragment, View } from \"../mosaic.js\";"), "{out}");
        assert_eq!(out.matches("import").count(), 1, "{out}");
    }

    #[test]
    fn a_source_relative_runtime_import_is_rewritten_for_the_output() {
        // The source says "../../runtime/mosaic.js"; the compiled file lives
        // elsewhere, so the specifier must become the --runtime value.
        let code = "import { Component } from \"../../runtime/mosaic.js\";\nclass A {}";
        let out = ensure_runtime_names(code, "../../src/js/runtime/mosaic.js", &["h", "Fragment"]);
        assert_eq!(out.matches("import").count(), 1, "{out}");
        assert!(
            out.starts_with("import { h, Fragment, Component } from \"../../src/js/runtime/mosaic.js\";"),
            "{out}"
        );
    }

    #[test]
    fn runtime_import_is_added_when_absent() {
        let out = ensure_runtime_names("const a = h(\"p\", null);", "../mosaic.js", &["h", "Fragment"]);
        assert!(out.starts_with("import { h, Fragment } from \"../mosaic.js\";"), "{out}");
    }

    #[test]
    fn runtime_import_is_left_alone_when_complete() {
        let code = "import { h, Fragment, View } from \"../mosaic.js\";";
        assert_eq!(ensure_runtime_names(code, "../mosaic.js", &["h", "Fragment"]), code);
    }

    #[test]
    fn css_imports_become_add_styles_calls() {
        let dir = std::env::temp_dir().join("ibcompile-css-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("counter.css"), ".a { color: red; }\n");

        let (out, found) =
            inline_css_imports("import \"./counter.css\";\nconst x = 1;", &dir, None).unwrap();
        assert!(found);
        assert!(out.starts_with("addStyles(\"counter\", \".a { color: red; }\");"), "{out}");
        assert!(out.contains("const x = 1;"), "{out}");
    }

    #[test]
    fn css_imports_are_found_through_source_map_markers() {
        // The transform inserts markers before this pass runs; a marker must not
        // hide the import, or the stylesheet is silently dropped.
        let dir = std::env::temp_dir().join("ibcompile-css-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("counter.css"), ".a { color: red; }").unwrap();

        let marked = format!("{}import \"./counter.css\";\n", line_marker(4));
        let (out, found) = inline_css_imports(&marked, &dir, None).unwrap();
        assert!(found, "{out}");
        assert!(out.contains("addStyles(\"counter\""), "{out}");
        assert!(out.contains(&line_marker(4)), "marker kept: {out}");
    }

    #[test]
    fn a_missing_stylesheet_is_an_error() {
        let dir = std::env::temp_dir().join("ibcompile-css-test");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(inline_css_imports("import \"./nope.css\";", &dir, None).is_err());
    }

    #[test]
    fn ordinary_imports_are_left_alone() {
        let dir = std::env::temp_dir();
        let code = "import { View } from \"../mosaic.js\";\nimport Card from \"./Card.js\";";
        let (out, found) = inline_css_imports(code, &dir, None).unwrap();
        assert!(!found);
        assert_eq!(out, code);
    }

    /// Tests read the code without the source-map markers.
    fn clean(src: &str) -> String {
        crate::codegen::take_line_markers(&transform(src, None).unwrap()).0
    }

    /// With a scope, elements are stamped and stylesheets are constrained.
    fn scoped(src: &str) -> String {
        crate::codegen::take_line_markers(&transform(src, Some("data-mosaic-x")).unwrap()).0
    }

    #[test]
    fn dom_elements_carry_the_scope_attribute() {
        let out = scoped("return <div styleName=\"a\"><span>x</span></div>;");
        assert!(out.contains("h(\"div\", { class: \"a\", \"data-mosaic-x\": \"\" }"), "{out}");
        assert!(out.contains("h(\"span\", { \"data-mosaic-x\": \"\" }"), "{out}");
    }

    #[test]
    fn the_view_element_is_scoped_too() {
        let out = scoped("return <View styleName=\"app\"/>;");
        assert_eq!(out, "return h(\"div\", { class: \"app\", \"data-mosaic-x\": \"\" });");
    }

    #[test]
    fn components_and_fragments_are_not_scoped() {
        // A component styles its own markup; a fragment is not an element.
        assert!(!scoped("return <Card title=\"x\"/>;").contains("data-mosaic-x"));
        let frag = scoped("return <><p>a</p></>;");
        assert!(frag.contains("h(Fragment, null"), "{frag}");
        assert!(!frag.contains("h(Fragment, { \"data-mosaic-x\""), "{frag}");
    }

    #[test]
    fn imported_css_is_scoped_to_the_module() {
        let dir = std::env::temp_dir().join("ibcompile-css-scope");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.css"), ".counter .step { width: 2rem; }\n:global(body) { margin: 0; }").unwrap();

        let (out, _) =
            inline_css_imports("import \"./a.css\";\n", &dir, Some("data-mosaic-x")).unwrap();
        assert!(out.contains(".counter .step[data-mosaic-x]{width: 2rem;}"), "{out}");
        assert!(out.contains("body{margin: 0;}"), "{out}");
    }

    #[test]
    fn element_becomes_h_call() {
        let out = clean("const a = <p>hi</p>;");
        assert_eq!(out, "const a = h(\"p\", null, \"hi\");");
    }

    #[test]
    fn style_name_becomes_class() {
        let out = clean("return <div styleName=\"box\"/>;");
        assert_eq!(out, "return h(\"div\", { class: \"box\" });");
    }

    #[test]
    fn view_tag_is_a_div() {
        let out = clean("return <View styleName=\"app\">x</View>;");
        assert_eq!(out, "return h(\"div\", { class: \"app\" }, \"x\");");
    }

    #[test]
    fn expressions_pass_through() {
        let out = clean("return <p>{this.count}</p>;");
        assert_eq!(out, "return h(\"p\", null, (this.count));");
    }

    #[test]
    fn attribute_expressions_pass_through() {
        let out = clean("return <input value={this.name}/>;");
        assert_eq!(out, "return h(\"input\", { value: (this.name) });");
    }

    #[test]
    fn nested_jsx_inside_an_expression() {
        let out = clean("return <ul>{items.map((i) => <li>{i}</li>)}</ul>;");
        assert_eq!(
            out,
            "return h(\"ul\", null, (items.map((i) => h(\"li\", null, (i)))));"
        );
    }

    #[test]
    fn one_action_attribute_binds_several_events() {
        let out = clean("return <button ib:action=\"pointerdown:onDown keyup:onUp\"/>;");
        assert!(out.contains("onpointerdown: (...__a) => this.onDown(...__a)"), "{out}");
        assert!(out.contains("onkeyup: (...__a) => this.onUp(...__a)"), "{out}");
        assert!(transform("return <b ib:action=\"click:a click:b\"/>;", None).is_err());
    }

    #[test]
    fn an_action_on_a_component_becomes_its_action_prop() {
        // The child calls it; the method lives on the parent that drew it.
        let out = clean("return <Button ib:action=\"decrement\"/>;");
        assert_eq!(out, "return h(Button, { action: (...__a) => this.decrement(...__a) });");

        let named = clean("return <List ib:action=\"select:onSelect\"/>;");
        assert!(named.contains("selectAction: (...__a) => this.onSelect(...__a)"), "{named}");
    }

    #[test]
    fn directives_work_in_jsx() {
        let out = clean("return <button ib:action=\"go\" ib:outlet=\"b\"/>;");
        assert!(out.contains("onclick: (...__a) => this.go(...__a)"), "{out}");
        assert!(out.contains("ref: (__el) => { this.b = __el; }"), "{out}");
    }

    #[test]
    fn fragments_are_supported() {
        let out = clean("return <><p>a</p><p>b</p></>;");
        assert_eq!(
            out,
            "return h(Fragment, null, h(\"p\", null, \"a\"), h(\"p\", null, \"b\"));"
        );
    }

    #[test]
    fn components_keep_their_identifier() {
        let out = clean("return <Card title=\"x\"/>;");
        assert_eq!(out, "return h(Card, { title: \"x\" });");
    }

    #[test]
    fn less_than_is_not_jsx() {
        let out = clean("const ok = a < b && c > d;");
        assert_eq!(out, "const ok = a < b && c > d;");
    }

    #[test]
    fn jsx_in_strings_is_untouched() {
        let out = clean("const s = \"<p>not jsx</p>\";");
        assert_eq!(out, "const s = \"<p>not jsx</p>\";");
    }

    #[test]
    fn class_attribute_is_rejected() {
        assert!(transform("return <p class=\"a\"/>;", None).is_err());
    }

    #[test]
    fn spread_props_are_merged() {
        let out = clean("return <p {...rest} id=\"a\"/>;");
        assert_eq!(out, "return h(\"p\", Object.assign({}, (rest), { id: \"a\" }));");
    }
}
