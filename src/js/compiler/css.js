// Minimal CSS transformer: rewrites selectors so every rule is constrained to
// elements carrying the component's scope class — its hash, `.x1y2z3q`.
//
// `.box span` becomes `.box span.x1y2z3q`. Pseudo-elements stay last:
// `.box::before` becomes `.box.x1y2z3q::before`. `:global(sel)` opts out.
//
// The suffix is whatever the caller passes, so what a scope is called is not
// this file's business.

/** Nested at-rules whose bodies contain further style rules. */
const NESTED_AT_RULES = ["@media", "@supports", "@container", "@layer", "@scope"];

const WS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const COMBINATORS = new Set([" ", "\t", "\n", ">", "+", "~"]);

/** `scopeSuffix` is appended to the last compound of every selector. */
export function scope(css, scopeSuffix) {
  const out = [];
  transformBlock(css, scopeSuffix, out);
  return out.join("");
}

function transformBlock(css, scopeSuffix, out) {
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
        transformBlock(body, scopeSuffix, out);
      } else {
        // @keyframes / @font-face bodies hold declarations, not selectors.
        out.push(body);
      }
      out.push("}");
    } else {
      out.push(scopeSelectorList(trimmed, scopeSuffix), "{", body.trim(), "}");
    }

    i = bodyEnd + 1;
  }
}

function matchingBrace(css, open) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const c = css[i];
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

function scopeSelectorList(list, scopeSuffix) {
  return splitTopLevel(list, ",")
      .map((s) => scopeSelector(s.trim(), scopeSuffix))
    .join(", ");
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
  return parts.map((p, i) => (i === target ? scopeCompound(p, scopeSuffix) : p)).join("");
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
