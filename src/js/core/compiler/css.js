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
  transformBlock(source, scopeSuffix, out, prefix, options.component ?? null);
  const text = out.join("");
  return options.minify ? squeeze(text) : text;
}

/** Whitespace after one of these never separates anything. */
const DROP_AFTER = new Set(["{", "}", ";", ",", "("]);
/** Nor does whitespace before one of these. */
const DROP_BEFORE = new Set(["{", "}", ";", ",", ")"]);
/** The combinators that are written down, as against the one that is a space. */
const WRITTEN_COMBINATORS = new Set([">", "+", "~"]);

/**
 * The whole sheet on one line, with every space that is not load-bearing gone.
 *
 * A stylesheet is carried into the bundle as a string, so the bundler's own
 * minifier never looks inside it: whatever whitespace is left here is
 * whitespace the application downloads. The sheets are written a declaration
 * to a line with a blank line between rules, and that is most of it — but the
 * spaces around `{`, `:`, `;` and `,` are the rest, and they add up.
 *
 * What cannot go is the whitespace that *is* a token. Between two compounds it
 * is the descendant combinator — `.a\n.b` matches what `.a .b` matches, and
 * running them together would mean something else entirely. In a value it
 * separates the parts of a shorthand, and in `calc()` it is required around
 * `+` and `-`. So a run of whitespace collapses to one space, and that space
 * is dropped only where the character on one side of it already ends the token
 * for us. Which side is safe depends on where in the sheet we are, which is
 * what `segmentAt` works out.
 *
 * Strings are passed over whole: a newline inside `content:` is content.
 */
function squeeze(css) {
  let out = "";
  let quote = null;
  let space = false;
  let paren = 0;
  let bracket = 0;
  let at = segmentAt(css, 0);

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
    // ends with one — and so the character on both sides of it is known
    // before it is decided on.
    const prev = out[out.length - 1] ?? "";
    if (space && out !== "" && !dropsSpace(prev, c, at, paren, bracket)) {
      out += " ";
    }
    space = false;

    if (c === '"' || c === "'") quote = c;
    else if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    out += c;

    // A brace or a semicolon ends what was being read and starts the next
    // thing, which may be a selector where the last one was a declaration.
    if ((c === "{" || c === "}" || c === ";") && paren === 0) {
      bracket = 0;
      at = segmentAt(css, i + 1);
    }
  }

  return out;
}

/**
 * Is the single space between `prev` and `c` one the sheet can do without?
 *
 * @param at      what is being read, from `segmentAt`
 * @param paren   nesting inside `(...)`
 * @param bracket nesting inside `[...]`
 */
function dropsSpace(prev, c, at, paren, bracket) {
  if (DROP_AFTER.has(prev) || DROP_BEFORE.has(c)) return true;

  // `color: red` and `(min-width: 40em)` — a colon there ends the property or
  // the feature name. In a selector it does not: `.a :hover` is a descendant
  // and `.a:hover` is not, so that space stays. An at-rule's parentheses hold
  // a query rather than a selector, which is why the two are told apart.
  const declaration = !at.prelude || (at.atRule && paren > 0);
  if (declaration && (prev === ":" || c === ":")) return true;
  // `red !important`.
  if (!at.prelude && c === "!") return true;

  if (at.prelude && !at.atRule) {
    // A combinator ends the compound before it and begins the one after, so
    // the spaces written around it for legibility carry nothing. Only at the
    // top level: inside `:not(...)` the same characters may sit in a value,
    // and a `calc()` in an `@media` prelude needs its spaces around `+`.
    if (
      paren === 0 &&
      (WRITTEN_COMBINATORS.has(prev) || WRITTEN_COMBINATORS.has(c))
    ) {
      return true;
    }
    // `[type = "text"]` — the brackets bound the whole thing.
    if (
      bracket > 0 &&
      (prev === "=" || c === "=" || prev === "[" || c === "]")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * What is being read at `i`: a prelude — a selector list, or an at-rule's name
 * and query — or a declaration. They are told apart by which comes first, the
 * `{` that would open a prelude's block or the `;`/`}` that would end a
 * declaration.
 *
 * `atRule` says the prelude is an at-rule's, so `(min-width: 40em)` is not
 * mistaken for `:not(...)`.
 */
function segmentAt(css, i) {
  let paren = 0;
  let quote = null;
  let atRule = false;
  let first = true;

  for (let j = i; j < css.length; j++) {
    const c = css[j];

    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      first = false;
      continue;
    }
    if (WS.has(c)) continue;

    if (first) {
      atRule = c === "@";
      first = false;
    }

    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (paren === 0) {
      if (c === "{") return { prelude: true, atRule };
      if (c === ";" || c === "}") return { prelude: false, atRule: false };
    }
  }
  // Nothing closes it — a declaration is the safer reading, since it is the
  // one that leaves a selector's combinators alone.
  return { prelude: false, atRule: false };
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

function transformBlock(
  css,
  scopeSuffix,
  out,
  prefix = null,
  component = null,
) {
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
        transformBlock(body, scopeSuffix, out, prefix, component);
      } else {
        // @keyframes / @font-face bodies hold declarations, not selectors.
        out.push(body);
      }
      out.push("}");
    } else {
      out.push(
        scopeSelectorList(trimmed, scopeSuffix, prefix, component),
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

/**
 * A compound naming a component, as the class that component wears.
 *
 * A stylesheet may say `ComboBox` where it means "the combo box" — the same
 * name the markup places it by — rather than having to know that a combo box
 * draws itself as `.v-ComboBox`. Written this way a sheet says what it means,
 * and a component free to change the class it wears does not take every sheet
 * that reached it down with it.
 *
 * Recognised by the capital: an element's tag is lower case, so `ComboBox` can
 * only be a component and `div` can only be an element. Whatever follows the
 * name is left alone, so `ComboBox.popup:hover` and `Button[disabled]` mean
 * what they look like.
 *
 * @param part      one compound, possibly with a combinator hanging off it
 * @param component name -> the class it wears, or null to leave names alone
 */
function asComponentClass(part, component) {
  if (!component) return part;

  const match = /^([A-Z][A-Za-z0-9_]*)/.exec(part.trimStart());
  if (!match) return part;

  const wears = component(match[1]);
  if (!wears) return part;

  const lead = part.length - part.trimStart().length;
  return part.slice(0, lead) + `.${wears}` + part.slice(lead + match[1].length);
}

function scopeSelectorList(list, scopeSuffix, prefix = null, component = null) {
  return splitTopLevel(list, ",")
    .map((s) =>
      withPrefix(scopeSelector(s.trim(), scopeSuffix, component), prefix),
    )
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
 * Scope the last compound that is not marked `:global(...)` — unless the
 * selector names a component, in which case the first.
 *
 * The two answer different questions. Anchored at the last compound the scope
 * says "an element I drew myself", which is what keeps a module's sheet off
 * everyone else's markup. Anchored at the first it says "inside an element I
 * drew", which is what a rule reaching into a component it placed needs:
 * `.mydialog ComboBox` cannot require the combo box's root to carry this
 * page's hash, because the combo box drew that root and gave it its own.
 *
 * Naming the component is what asks for the second reading. It is a thing a
 * sheet can only mean one way — a page that writes `ComboBox` is talking about
 * a combo box it placed, not about markup of its own — so the anchor moves and
 * nothing written the old way changes meaning.
 *
 * Either way the anchor is an element this module drew, so a rule still only
 * reaches into that module's own subtree.
 *
 * A compound belonging to someone else marks itself `:global()`, and the
 * anchor skips it — `:global(.v-Button) .icon` scopes `.icon`, as it always
 * did. `:global()` may wrap the whole selector or just one compound.
 */
function scopeSelector(sel, scopeSuffix, component = null) {
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

  // A component's name stands for the class it wears, inside `:global()` as
  // much as outside it — the name is how a sheet refers to the component
  // either way, and whether the rule is scoped is a separate question.
  let names = false;
  for (let i = 0; i < parts.length; i++) {
    const asClass = asComponentClass(parts[i], component);
    if (asClass !== parts[i]) names = true;
    parts[i] = asClass;
  }

  // The scopable compound at whichever end this selector is anchored by.
  // Combinator pieces ("` > `") are not compounds and never take it.
  const order = names
    ? parts.map((_, i) => i)
    : parts.map((_, i) => parts.length - 1 - i);

  let target = -1;
  for (const i of order) {
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
