// Minimal CSS transformer: rewrites selectors so every rule is constrained to
// elements carrying the component's scope class — its hash, `.x1y2z3q`.
//
// `.box span` becomes `.box span.x1y2z3q`. Pseudo-elements stay last:
// `.box::before` becomes `.box.x1y2z3q::before`. `:global(sel)` opts out.
//
// The suffix is whatever the caller passes, so what a scope is called is not
// this file's business.

/** Nested at-rules whose bodies contain further style rules. */
const NESTED_AT_RULES = [
  "@media",
  "@supports",
  "@container",
  "@layer",
  "@scope",
  // The state an element transitions *from* the first time it is rendered.
  // Its body holds style rules like any other, and a dialog's fade-in is
  // written with it — see dialog.css.
  "@starting-style",
];

const WS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const COMBINATORS = new Set([" ", "\t", "\n", ">", "+", "~"]);

/**
 * Rewrite every selector in `css`.
 *
 * `scopeSuffix` is appended to the last compound of each one — how a
 * component's stylesheet is constrained to that component's elements.
 *
 * `prefix` is put in front of each one instead, which raises what a rule
 * outscores without changing what it matches. A theme is written unscoped and
 * uses `:root` for this: it has to beat a component's own stylesheet, which
 * carries a scope class the theme's selectors have no way to name. A selector
 * that already starts with the prefix is left alone, so the theme's own
 * `:root { --vars }` stays what it was.
 */
export function scope(css, scopeSuffix, prefix = null, options = {}) {
  const source = options.minify ? stripComments(css) : css;
  const out = [];
  transformBlock(source, scopeSuffix, out, prefix);
  const text = out.join("");
  return options.minify ? oneLine(text) : text;
}

/**
 * The whole sheet on one line.
 *
 * A stylesheet is carried into the bundle as a string, and a string's newlines
 * are the one kind of whitespace the bundler cannot take out for us: they ship
 * as `\n` in the source and as line breaks in the served file. The sheets are
 * written a declaration to a line with a blank line between rules, so that is
 * most of what is left once the comments are gone.
 *
 * Every run of whitespace becomes a single space rather than nothing at all,
 * because whitespace between two compounds is a descendant combinator: `.a\n.b`
 * matches what `.a .b` matches, and running them together would mean something
 * else entirely. A space is what that newline already was, so nothing changes
 * meaning — and a run of one is no run at all. Strings are passed over whole:
 * a newline inside `content:` is content.
 */
function oneLine(css) {
  let out = "";
  let quote = null;
  let space = false;

  for (let i = 0; i < css.length; i++) {
    const c = css[i];

    if (quote) {
      out += c;
      if (c === "\\") out += css[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }

    if (WS.has(c)) {
      space = true;
      continue;
    }

    // Held back until something follows it, so a sheet neither starts nor
    // ends with one.
    if (space && out !== "") out += " ";
    space = false;

    if (c === '"' || c === "'") quote = c;
    out += c;
  }

  return out;
}

/**
 * Every comment taken out.
 *
 * A stylesheet is carried into the bundle as a string, so the bundler's own
 * minifier never sees inside it and its prose ships with the application. This
 * is what `--minify` uses to leave that behind.
 *
 * Removed rather than replaced with a space: a comment separates tokens
 * without standing between them, so `.a/*x*\/.b` is `.a.b` and always was.
 * Strings are stepped over — a `content: "/*"` is content, not a comment.
 */
function stripComments(css) {
  let out = "";
  let i = 0;

  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      i = skipComment(css, i);
      continue;
    }

    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

function transformBlock(css, scopeSuffix, out, prefix = null) {
  let i = 0;
  while (i < css.length) {
    // Emit leading whitespace and comments verbatim — a comment is not a
    // selector and must never be scoped.
    const wsStart = i;
    while (i < css.length && WS.has(css[i])) i++;
    if (css.startsWith("/*", i)) {
      const found = css.indexOf("*/", i);
      const end = found === -1 ? css.length : found + 2;
      out.push(css.slice(wsStart, end));
      i = end;
      continue;
    }
    i = wsStart;

    // Collect the prelude up to `{` (or `;` for statements like @import).
    const start = i;
    let depthParen = 0;
    while (i < css.length) {
      const c = css[i];
      // As in matchingBrace: a comment inside a prelude is prose, and neither
      // its punctuation nor its apostrophes are CSS.
      if (css.startsWith("/*", i)) {
        i = skipComment(css, i);
        continue;
      }
      if (c === "(") depthParen++;
      else if (c === ")") depthParen--;
      else if ((c === "{" || c === ";") && depthParen === 0) break;
      i++;
    }
    if (i >= css.length) {
      out.push(css.slice(start));
      return;
    }
    const prelude = css.slice(start, i);

    if (css[i] === ";") {
      // Statement at-rule (@import, @charset) — pass through.
      out.push(prelude, ";");
      i++;
      continue;
    }

    const bodyStart = i + 1;
    const bodyEnd = matchingBrace(css, i);
    if (bodyEnd === -1) {
      out.push(css.slice(start));
      return;
    }
    const body = css.slice(bodyStart, bodyEnd);

    const trimmed = prelude.trim();
    out.push(prelude.slice(0, prelude.length - prelude.trimStart().length));

    if (trimmed.startsWith("@")) {
      const name = trimmed.split(/[\s(]/)[0];
      out.push(trimmed, "{");
      if (NESTED_AT_RULES.includes(name)) {
        transformBlock(body, scopeSuffix, out, prefix);
      } else {
        // @keyframes / @font-face bodies hold declarations, not selectors.
        out.push(body);
      }
      out.push("}");
    } else {
      out.push(
        scopeSelectorList(trimmed, scopeSuffix, prefix),
        "{",
        body.trim(),
        "}",
      );
    }

    i = bodyEnd + 1;
  }
}

/** The index just past the comment starting at `at`, or the end of the sheet. */
function skipComment(css, at) {
  const end = css.indexOf("*/", at + 2);
  return end === -1 ? css.length : end + 2;
}

function matchingBrace(css, open) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const c = css[i];
    // A comment is skipped whole. Prose is not CSS: an apostrophe in one —
    // "the push button's face" — would otherwise open a string that runs to
    // the next apostrophe in the file, swallowing this rule's closing brace
    // and everything after it.
    if (css.startsWith("/*", i)) {
      i = skipComment(css, i);
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c) i += css[i] === "\\" ? 2 : 1;
    }
    i++;
  }
  return -1;
}

function scopeSelectorList(list, scopeSuffix, prefix = null) {
  return splitTopLevel(list, ",")
    .map((s) => withPrefix(scopeSelector(s.trim(), scopeSuffix), prefix))
    .join(", ");
}

/** `.v-Button` -> `:root .v-Button`, leaving one that already starts there. */
function withPrefix(selector, prefix) {
  if (!prefix) return selector;
  const trimmed = selector.trim();
  if (trimmed === "" || trimmed === prefix || trimmed.startsWith(`${prefix} `))
    return selector;
  // `:root:root` rather than `:root :root`: the root is not inside itself.
  if (trimmed.startsWith(prefix)) return selector;
  return `${prefix} ${trimmed}`;
}

/**
 * Scope the last compound that is not marked `:global(...)`.
 *
 * `:global()` may wrap the whole selector or just one compound, so
 * `.todo :global(.item)` becomes `.todo.x1y2z3q .item` — the container is
 * scoped, the descendant is left open for nodes a controller builds.
 */
function scopeSelector(sel, scopeSuffix) {
  const parts = splitCompounds(sel);

  // Unwrap `:global(...)`, remembering which pieces opted out of scoping.
  const isGlobal = parts.map(() => false);
  parts.forEach((part, i) => {
    const inner = stripGlobal(part.trim());
    if (inner !== null) {
      parts[i] = inner + part.slice(part.trimEnd().length);
      isGlobal[i] = true;
    }
  });

  // The last scopable compound carries the scope. Combinator pieces
  // ("` > `") are not compounds and never take it.
  let target = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!isGlobal[i] && !isCombinator(parts[i])) {
      target = i;
      break;
    }
  }

  // Every compound was `:global(...)` — emit it unscoped.
  if (target === -1) return parts.join("");
  return parts
    .map((p, i) => (i === target ? scopeCompound(p, scopeSuffix) : p))
    .join("");
}

function isCombinator(part) {
  return part.length > 0 && [...part].every((c) => COMBINATORS.has(c));
}

function stripGlobal(sel) {
  if (!sel.startsWith(":global(") || !sel.endsWith(")")) return null;
  return sel.slice(":global(".length, -1).trim();
}

/**
 * Insert the scope after the element/class/id part of a compound selector but
 * before any pseudo-element or pseudo-class.
 */
function scopeCompound(compound, scopeSuffix) {
  const trimmed = compound.trimEnd();
  const trailingWs = compound.slice(trimmed.length);
  if (trimmed === "") return compound;

  let cut = trimmed.length;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ":" && depth === 0) {
      cut = i;
      break;
    }
  }
  return `${trimmed.slice(0, cut)}${scopeSuffix}${trimmed.slice(cut)}${trailingWs}`;
}

/**
 * Split a complex selector into pieces, keeping combinators attached to the
 * piece that precedes the following compound (e.g. `["a ", "> ", "b"]`).
 */
function splitCompounds(sel) {
  const parts = [];
  let cur = "";
  let depth = 0;
  let inCombinator = false;

  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(" || c === "[") {
      depth++;
      inCombinator = false;
      cur += c;
    } else if (c === ")" || c === "]") {
      depth--;
      cur += c;
    } else if (COMBINATORS.has(c) && depth === 0) {
      if (!inCombinator && cur !== "") {
        parts.push(cur);
        cur = "";
      }
      inCombinator = true;
      cur += c;
      // Absorb the whole combinator run into this piece.
      while (i + 1 < sel.length && COMBINATORS.has(sel[i + 1])) {
        cur += sel[++i];
      }
      parts.push(cur);
      cur = "";
    } else {
      inCombinator = false;
      cur += c;
    }
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

function splitTopLevel(s, sep) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (const c of s) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
