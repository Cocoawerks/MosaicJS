//! Minimal CSS transformer: rewrites selectors so every rule is constrained to
//! elements carrying the component's scope attribute (`[data-mosaic-<hash>]`).
//!
//! `.box span` becomes `.box span[data-mosaic-x1y2]`. Pseudo-elements stay last:
//! `.box::before` becomes `.box[data-mosaic-x1y2]::before`. `:global(sel)` opts out.

/// Nested at-rules whose bodies contain further style rules.
const NESTED_AT_RULES: &[&str] = &["@media", "@supports", "@container", "@layer", "@scope"];

pub fn scope(css: &str, scope_attr: &str) -> String {
    let mut out = String::new();
    transform_block(css, scope_attr, &mut out);
    out
}

fn transform_block(css: &str, scope_attr: &str, out: &mut String) {
    let b = css.as_bytes();
    let mut i = 0;
    while i < b.len() {
        // Emit leading whitespace and comments verbatim — a comment is not a
        // selector and must never be scoped.
        let ws_start = i;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            let end = css[i..].find("*/").map(|j| i + j + 2).unwrap_or(b.len());
            out.push_str(&css[ws_start..end]);
            i = end;
            continue;
        }
        i = ws_start;

        // Collect the prelude up to `{` (or `;` for statements like @import).
        let start = i;
        let mut depth_paren = 0i32;
        while i < b.len() {
            match b[i] {
                b'(' => depth_paren += 1,
                b')' => depth_paren -= 1,
                b'{' | b';' if depth_paren == 0 => break,
                _ => {}
            }
            i += 1;
        }
        if i >= b.len() {
            out.push_str(&css[start..]);
            return;
        }
        let prelude = &css[start..i];

        if b[i] == b';' {
            // Statement at-rule (@import, @charset) — pass through.
            out.push_str(prelude);
            out.push(';');
            i += 1;
            continue;
        }

        let body_start = i + 1;
        let Some(body_end) = matching_brace(b, i) else {
            out.push_str(&css[start..]);
            return;
        };
        let body = &css[body_start..body_end];

        let trimmed = prelude.trim();
        let leading = &prelude[..prelude.len() - prelude.trim_start().len()];
        out.push_str(leading);

        if trimmed.starts_with('@') {
            let name = trimmed
                .split(|c: char| c.is_whitespace() || c == '(')
                .next()
                .unwrap_or("");
            out.push_str(trimmed);
            out.push('{');
            if NESTED_AT_RULES.contains(&name) {
                transform_block(body, scope_attr, out);
            } else {
                // @keyframes / @font-face bodies hold declarations, not selectors.
                out.push_str(body);
            }
            out.push('}');
        } else {
            out.push_str(&scope_selector_list(trimmed, scope_attr));
            out.push('{');
            out.push_str(body.trim());
            out.push('}');
        }

        i = body_end + 1;
    }
}

fn matching_brace(b: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = open;
    while i < b.len() {
        match b[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            b'"' | b'\'' => {
                let q = b[i];
                i += 1;
                while i < b.len() && b[i] != q {
                    i += if b[i] == b'\\' { 2 } else { 1 };
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn scope_selector_list(list: &str, scope_attr: &str) -> String {
    split_top_level(list, ',')
        .iter()
        .map(|s| scope_selector(s.trim(), scope_attr))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Scope the last compound that is not marked `:global(...)`.
///
/// `:global()` may wrap the whole selector or just one compound, so
/// `.todo :global(.item)` becomes `.todo[data-mosaic-x] .item` — the container is
/// scoped, the descendant is left open for nodes a controller builds.
fn scope_selector(sel: &str, scope_attr: &str) -> String {
    let mut parts = split_compounds(sel);

    // Unwrap `:global(...)`, remembering which pieces opted out of scoping.
    let mut is_global = vec![false; parts.len()];
    for (i, part) in parts.iter_mut().enumerate() {
        if let Some(inner) = strip_global(part.trim()) {
            let trailing = &part[part.trim_end().len()..];
            *part = format!("{}{}", inner, trailing);
            is_global[i] = true;
        }
    }

    // The last scopable compound carries the attribute. Combinator pieces
    // ("` > `") are not compounds and never take it.
    let target = parts
        .iter()
        .enumerate()
        .rfind(|(i, p)| !is_global[*i] && !is_combinator(p));

    match target {
        Some((idx, _)) => parts
            .iter()
            .enumerate()
            .map(|(i, p)| {
                if i == idx {
                    scope_compound(p, scope_attr)
                } else {
                    p.clone()
                }
            })
            .collect(),
        // Every compound was `:global(...)` — emit it unscoped.
        None => parts.concat(),
    }
}

fn is_combinator(part: &str) -> bool {
    !part.is_empty() && part.chars().all(|c| matches!(c, ' ' | '\t' | '\n' | '>' | '+' | '~'))
}

fn strip_global(sel: &str) -> Option<&str> {
    let rest = sel.strip_prefix(":global(")?;
    let inner = rest.strip_suffix(')')?;
    Some(inner.trim())
}

/// Insert the scope attribute after the element/class/id part of a compound
/// selector but before any pseudo-element or pseudo-class.
fn scope_compound(compound: &str, scope_attr: &str) -> String {
    let trimmed = compound.trim_end();
    let trailing_ws = &compound[trimmed.len()..];
    if trimmed.is_empty() {
        return compound.to_string();
    }
    let b = trimmed.as_bytes();
    let mut cut = trimmed.len();
    let mut depth = 0i32;
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b':' if depth == 0 => {
                cut = i;
                break;
            }
            _ => {}
        }
    }
    format!(
        "{}[{}]{}{}",
        &trimmed[..cut],
        scope_attr,
        &trimmed[cut..],
        trailing_ws
    )
}

/// Split a complex selector into pieces, keeping combinators attached to the
/// piece that precedes the following compound (e.g. `["a ", "> ", "b"]`).
fn split_compounds(sel: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    let mut in_combinator = false;
    let mut chars = sel.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '(' | '[' => {
                depth += 1;
                in_combinator = false;
                cur.push(c);
            }
            ')' | ']' => {
                depth -= 1;
                cur.push(c);
            }
            ' ' | '\t' | '\n' | '>' | '+' | '~' if depth == 0 => {
                if !in_combinator && !cur.is_empty() {
                    parts.push(std::mem::take(&mut cur));
                }
                in_combinator = true;
                cur.push(c);
                // Absorb the whole combinator run into this piece.
                while let Some(&n) = chars.peek() {
                    if matches!(n, ' ' | '\t' | '\n' | '>' | '+' | '~') {
                        cur.push(n);
                        chars.next();
                    } else {
                        break;
                    }
                }
                parts.push(std::mem::take(&mut cur));
            }
            _ => {
                in_combinator = false;
                cur.push(c);
            }
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}

fn split_top_level(s: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            _ => {}
        }
        if c == sep && depth == 0 {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(c);
        }
    }
    out.push(cur);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_last_compound() {
        assert_eq!(scope(".box span{color:red}", "data-mosaic-x"), ".box span[data-mosaic-x]{color:red}");
    }

    #[test]
    fn keeps_pseudo_element_last() {
        assert_eq!(scope("a::before{content:''}", "data-mosaic-x"), "a[data-mosaic-x]::before{content:''}");
    }

    #[test]
    fn recurses_into_media() {
        let out = scope("@media (min-width:1px){.a{color:red}}", "data-mosaic-x");
        assert_eq!(out, "@media (min-width:1px){.a[data-mosaic-x]{color:red}}");
    }

    #[test]
    fn comments_are_not_selectors() {
        let out = scope("/* a note */\n.a{color:red}", "data-mosaic-x");
        assert_eq!(out, "/* a note */\n.a[data-mosaic-x]{color:red}");
    }

    #[test]
    fn comment_between_rules_survives() {
        let out = scope(".a{color:red}/* mid */.b{color:blue}", "data-mosaic-x");
        assert_eq!(out, ".a[data-mosaic-x]{color:red}/* mid */.b[data-mosaic-x]{color:blue}");
    }

    #[test]
    fn leaves_keyframes_alone() {
        let out = scope("@keyframes spin{from{opacity:0}}", "data-mosaic-x");
        assert_eq!(out, "@keyframes spin{from{opacity:0}}");
    }

    #[test]
    fn global_escape_hatch() {
        assert_eq!(scope(":global(body){margin:0}", "data-mosaic-x"), "body{margin:0}");
    }

    #[test]
    fn global_on_a_descendant_scopes_only_the_container() {
        // The pattern for controller-built children: the container is scoped,
        // the rows are not.
        let out = scope(".todo :global(.item){color:red}", "data-mosaic-x");
        assert_eq!(out, ".todo[data-mosaic-x] .item{color:red}");
    }

    #[test]
    fn global_descendant_keeps_combinators() {
        let out = scope(".a > :global(.b){color:red}", "data-mosaic-x");
        assert_eq!(out, ".a[data-mosaic-x] > .b{color:red}");
    }

    #[test]
    fn global_container_still_scopes_a_local_descendant() {
        let out = scope(":global(.a) .b{color:red}", "data-mosaic-x");
        assert_eq!(out, ".a .b[data-mosaic-x]{color:red}");
    }
}
