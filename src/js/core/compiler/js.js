// Emitting JavaScript source text: quoting, object keys, and the line markers
// that carry source positions through codegen into the source map.

/**
 * The markup extension: a Mosaic Interface Builder file.
 *
 * It compiles to `<name>.mib.js` — the whole name plus `.js` — which is what
 * leaves `<name>.js` free to be the module beside it.
 */
export const MARKUP_EXT = ".mib";

/** The built-in view element. */
export const VIEW_TAG = "View";
/** How markup names the CSS class, on every element — never `class`. */
export const STYLE_NAME_ATTR = "styleName";
/** Binds a method: a listener on a DOM element, an action on a component. */
export const ACTION_ATTR = "action";

/**
 * A module's scope, as a class name. Every element the module renders carries
 * it, and every selector in its stylesheet requires it.
 *
 * A class rather than an attribute: it costs a selector one point of
 * specificity instead of ten, so a scoped rule still loses to an id and beats
 * a bare tag by the usual amount — the cascade goes on meaning what it meant.
 *
 * The hash stands on its own, with nothing prefixed. It is generated to begin
 * with a letter, so it is a valid class name wherever it appears.
 */
export function scopeClass(hash) {
  return hash;
}

/** `outlet="name"` binds the rendered node to `this.name`. */
export const OUTLET_ATTR = "outlet";
/** Event assumed when an action names only a method. */
export const DEFAULT_EVENT = "click";

export function jsString(s) {
  let out = '"';
  for (const c of s) {
    const code = c.codePointAt(0);
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += c;
  }
  return out + '"';
}

/** An identifier is safe as a bare object key; anything else gets quoted. */
export function jsKey(k) {
  return isIdent(k) ? k : jsString(k);
}

export function isIdent(s) {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(s);
}

/** A dotted path of identifiers: `count`, `user.name`. */
export function isPath(s) {
  return s.length > 0 && s.split(".").every(isIdent);
}

/**
 * A marker consumed by the source-map pass and then removed. Emitting it as a
 * comment keeps the intermediate output valid JavaScript.
 */
export function lineMarker(line) {
  return `/*@L${line}*/`;
}

/**
 * Strip line markers, returning the clean code and a `[output line, source
 * line]` pair for every output line whose origin is known.
 */
export function takeLineMarkers(code) {
  let out = "";
  const mappings = [];
  let outLine = 1;

  for (const line of splitInclusive(code)) {
    let rest = line;
    let first = null;
    let cleaned = "";

    for (;;) {
      const start = rest.indexOf("/*@L");
      if (start === -1) break;
      const endRel = rest.indexOf("*/", start);
      if (endRel === -1) break;
      const n = Number.parseInt(rest.slice(start + 4, endRel), 10) || 0;
      if (first === null && n > 0) first = n;
      cleaned += rest.slice(0, start);
      rest = rest.slice(endRel + 2);
    }
    cleaned += rest;

    if (first !== null) mappings.push([outLine, first]);
    out += cleaned;
    if (cleaned.endsWith("\n")) outLine++;
  }
  return [out, mappings];
}

/** Rust's `split_inclusive('\n')`: lines that keep their trailing newline. */
export function splitInclusive(s) {
  if (s === "") return [];
  const out = s.split("\n").map((l, i, all) => (i < all.length - 1 ? l + "\n" : l));
  if (out[out.length - 1] === "") out.pop();
  return out;
}
