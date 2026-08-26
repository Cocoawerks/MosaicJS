// Emitting JavaScript source text: quoting, object keys, and the line markers
// that carry source positions through codegen into the source map.
import * as path from "node:path";

/**
 * The markup extension: a Mosaic Interface Builder file.
 *
 * Two parts rather than one, so an editor that knows nothing of Mosaic still
 * highlights the file as the XML it is, and so the `.ib` in the middle stays
 * to say whose XML it is. `path.extname` sees only `.xml`, which is why the
 * two helpers below exist and why nothing compares extensions by hand.
 *
 * It compiles to `<name>.ib.js` — the `.xml` goes, since what comes out is a
 * module and not markup, and the `.ib` stays to leave `<name>.js` free for the
 * module beside it.
 */
export const MARKUP_EXT = ".ib.xml";

/** What a compiled markup file is called, in place of MARKUP_EXT. */
export const MARKUP_OUT_EXT = ".ib";

/** Whether `file` is markup, by its whole name rather than its extension. */
export function isMarkup(file) {
  return file.endsWith(MARKUP_EXT);
}

/**
 * The name a file is known by, with any extension taken off: `main.ib.xml`
 * and `main.js` are both `main`, which is what pairs the two.
 *
 * `path.basename(file, path.extname(file))` is what this replaces — it takes
 * one extension off, which for `main.ib.xml` leaves `main.ib`.
 */
export function stemOf(file) {
  const base = path.basename(file);
  return isMarkup(base)
    ? base.slice(0, -MARKUP_EXT.length)
    : path.basename(base, path.extname(base));
}

/**
 * The tag every markup file is wrapped in.
 *
 * One root and nothing beside it is what makes the file an XML document rather
 * than a fragment: the view and the `<style>` block are two elements, and two
 * roots is what no XML parser accepts — an editor reports it before any
 * inspection runs, so there is no comment that can wave it through.
 *
 * Lowercase, so it cannot be mistaken for a component: a capitalised tag is
 * another module, and this one is the file itself. It draws nothing — its
 * children are the file's content, and the tag is gone before codegen sees
 * anything.
 *
 * Comments may sit outside it, as XML allows before and after a root.
 */
export const ROOT_TAG = "interface";

/**
 * Points a page at the owner it draws against, on its root tag —
 * `<interface owner='./path/to/Owner'>`. The value is a module path resolved
 * relative to the markup, as a JS import is, so the owner may live anywhere the
 * source tree reaches. Overrides the `FooController.js` convention, so an
 * owner's name and location need not follow the page's.
 */
export const OWNER_ATTR = "owner";

/** The built-in view element. */
export const VIEW_TAG = "View";

/** How markup names the CSS class, on every element — never `class`. */
export const STYLE_NAME_ATTR = "styleName";
/** Binds a method: a listener on a DOM element, an action on a component. */
export const ACTION_ATTR = "action";

/**
 * The one tag the compiler knows the meaning of.
 *
 * `<Bind source="slider.value" target="volume"/>` reads its paths against this
 * file's scope — the controller the markup draws against — so the compiler
 * hands it that scope where it stands. Written out, the tag becomes
 * `h(Bind, { source: …, target: …, scope: this })`, and `this` in a compiled
 * `.ib.xml` is exactly the file's own controller.
 *
 * Said at compile time rather than worked out at run time because it is a
 * lexical fact: the scope a path belongs to is the file the path was written
 * in, and the file is what the compiler has in its hands. A tag left to find
 * its own scope has to search the document for one, which is a different
 * question with a different answer — the nearest scope *around* it, which is
 * whatever page happened to place this one.
 */
export const BIND_TAG = "Bind";
/** What the compiler passes it. */
export const BIND_SCOPE_PROP = "scope";

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
 * The one name a binding may start with that is not the controller's.
 *
 * `{MESSAGES.Save}` is a translation, looked up in the application's messages
 * rather than read off the controller. Reserved, so a controller may not have a
 * property that answers to it, and in capitals so that it cannot be mistaken
 * for one: `messages` is an ordinary thing for a controller to hold — a chat
 * log, a list of validation messages — and a page bound to the wrong one of
 * those would draw nothing and say nothing about why.
 */
export const MESSAGES_ROOT = "MESSAGES";

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
  const out = s
    .split("\n")
    .map((l, i, all) => (i < all.length - 1 ? l + "\n" : l));
  if (out[out.length - 1] === "") out.pop();
  return out;
}
