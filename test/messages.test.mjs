// Messages — `{MESSAGES.Key}` in `.ib.xml` markup, and what a change of locale
// does to a page that is already drawn.
//
// The compiler is exercised directly here rather than through a built example:
// what is being checked is the shape of what it emits and what the runtime then
// does with it, and both are in this repository.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { parse } = await import("../src/js/core/compiler/parser.js");
const { generate } = await import("../src/js/core/compiler/codegen.js");
const { MESSAGES, Messages, mount, setLocale } = await import(
  "../src/js/core/runtime/mosaic.js"
);

/** Compile markup and return the module's source, as the compiler writes it. */
function compile(markup) {
  return generate(parse(`<interface>${markup}</interface>`), {
    runtime: "mosaic",
    name: "Main",
    hash: "test",
  });
}

/**
 * Compile markup, evaluate it against the real runtime, and mount it.
 *
 * The generated module imports from "mosaic", which is a bare specifier with
 * nothing to resolve it here — so the imports are cut off and the runtime is
 * handed in as arguments instead. What runs is the compiler's own output.
 */
async function draw(markup, controller = {}) {
  const runtime = await import("../src/js/core/runtime/mosaic.js");
  const source = compile(markup)
    .replace(/^import .*$/gm, "")
    .replace("export default function", "return function");

  const names = ["h", "Fragment", "bindText", "bindMessage", "bindAttr", "bindProp", "addStyles"];
  const make = new Function(...names, source);
  const component = make(...names.map((n) => runtime[n]));

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(component, host, {}, controller);
  return host;
}

/** Start each test from a known catalog. */
function catalogs() {
  MESSAGES.catalogs = {
    en: {},
    fr: { Save: "Enregistrer", Search: "Rechercher", WelcomeBack: "Bon retour" },
  };
  MESSAGES.bound = new Map();
  MESSAGES.dependents = new Set();
  MESSAGES.registered = new WeakSet();
  MESSAGES._locale = "en";
}

// ---------------------------------------------------------- the class ---

test("a key with no translation is the English it already is", () => {
  const messages = new Messages({ en: {}, fr: { Save: "Enregistrer" } }, "fr");

  assert.equal(messages.get("Save"), "Enregistrer");
  // Not "", and not "MESSAGES.Untranslated": the key is the string.
  assert.equal(messages.get("Cancel"), "Cancel");
  assert.equal(messages.has("Cancel"), false);
});

test("format fills in what the message left open", () => {
  const messages = new Messages(
    { en: { Greeting: "Hello, {name} — {count} waiting" } },
    "en",
  );

  assert.equal(
    messages.format("Greeting", { name: "Ada", count: 3 }),
    "Hello, Ada — 3 waiting",
  );
  // A placeholder nothing was passed for is left as it stands, so the gap says
  // which one was forgotten.
  assert.equal(messages.format("Greeting", { name: "Ada" }), "Hello, Ada — {count} waiting");
});

test("a translation is whatever script it is written in", () => {
  const messages = new Messages(
    { en: {}, ru: { Save: "Сохранить", "Close picture": "Закрыть изображение" } },
    "ru",
  );

  assert.equal(messages.get("Save"), "Сохранить");
  assert.equal(messages.get("Close picture"), "Закрыть изображение");
  // And a key with nothing under it is still the English it already is.
  assert.equal(messages.get("Hue"), "Hue");
});

test("a placeholder may be named in the language it sits in", () => {
  // The key names its places in English; a translation need not. `\\w` is
  // ASCII, so this used to leave `{имя}` standing in the finished sentence.
  const messages = new Messages(
    { ru: { "Hello, {name}.": "Здравствуйте, {имя}." } },
    "ru",
  );

  assert.equal(messages.format("Hello, {name}.", { имя: "Ада" }), "Здравствуйте, Ада.");
});

test("an unknown locale is refused rather than silently English", () => {
  const messages = new Messages({ en: {} }, "en");
  assert.throws(() => messages.setLocale("de"), /no locale "de" in this build/);
});

// ------------------------------------------------------- the compiler ---

test("MESSAGES is reserved: a binding under it compiles to a lookup", () => {
  const out = compile("<p>{MESSAGES.Save}</p>");

  assert.match(out, /bindMessage\("Save"\)/);
  assert.match(out, /import \{[^}]*bindMessage[^}]*\} from "mosaic"/);
  // No controller: a message does not come from one.
  assert.doesNotMatch(out, /bindMessage\(this/);
});

test("an ordinary path still compiles to a read off the controller", () => {
  const out = compile("<p>{count}</p>");
  assert.match(out, /bindText\(this, "count"\)/);
  assert.doesNotMatch(out, /bindMessage/);
});

test("a message in an attribute rides inside the attribute's own binding", () => {
  const out = compile('<input placeholder="{MESSAGES.Search}"/>');

  assert.match(out, /placeholder: bindAttr\(this, \[\{ key: "Search" \}\]\)/);
  // It needs no bindMessage import: the attribute already had a call.
  assert.doesNotMatch(out, /bindMessage/);
});

test("a message and a path can share one attribute value", () => {
  const out = compile('<p title="{MESSAGES.SavedAt} {time}"></p>');
  assert.match(
    out,
    /bindAttr\(this, \[\{ key: "SavedAt" \}, " ", \{ path: "time" \}\]\)/,
  );
});

test("a component's prop takes one too", () => {
  const out = compile('<Button text="{MESSAGES.Save}"/>');
  assert.match(out, /text: bindProp\(this, \[\{ key: "Save" \}\]\)/);
});

test("everything after MESSAGES is the key, dots included", () => {
  const out = compile("<p>{MESSAGES.dialog.Save}</p>");
  assert.match(out, /bindMessage\("dialog\.Save"\)/);
});

test("a key is the English, spaces and punctuation and all", () => {
  // The point of keying on English: a path has to be a path because it is
  // walked across an object; a key is looked up whole, so it is a sentence.
  const out = compile("<p>{MESSAGES.Open a file, or save it.}</p>");
  assert.match(out, /bindMessage\("Open a file, or save it\."\)/);

  const attr = compile('<Button text="{MESSAGES.Open picture…}"/>');
  assert.match(attr, /\{ key: "Open picture…" \}/);
});

test("a key may be written in any script", () => {
  // Nothing about a key is an identifier — it is looked up whole — so an
  // application whose source language is not English keys on its own.
  const out = compile("<p>{MESSAGES.Привет}</p>");
  assert.match(out, /bindMessage\("Привет"\)/);
});

test("a path is still held to being a path", () => {
  assert.throws(
    () => compile("<p>{not a path}</p>"),
    /is not a property path/,
  );
});

test("MESSAGES on its own names no message", () => {
  assert.throws(() => compile("<p>{MESSAGES}</p>"), /names no message/);
  assert.throws(() => compile("<p>{MESSAGES.}</p>"), /names no message/);
});

// -------------------------------------------------------- the runtime ---

test("a message is drawn in the active locale", async () => {
  catalogs();
  const host = await draw("<p>{MESSAGES.WelcomeBack}</p>");
  assert.equal(host.textContent, "WelcomeBack");

  setLocale("fr");
  assert.equal(host.textContent, "Bon retour");
});

test("switching locale rewrites text without redrawing anything", async () => {
  catalogs();
  const host = await draw("<p>{MESSAGES.Save}</p>");
  const node = host.querySelector("p").childNodes[0];

  setLocale("fr");

  assert.equal(node.textContent, "Enregistrer");
  // The same text node, written again — as a theme swap is the same elements
  // wearing a different sheet.
  assert.equal(host.querySelector("p").childNodes[0], node);
});

test("an attribute follows the locale too", async () => {
  catalogs();
  const host = await draw('<input placeholder="{MESSAGES.Search}"/>');
  const input = host.querySelector("input");
  assert.equal(input.getAttribute("placeholder"), "Search");

  setLocale("fr");
  assert.equal(input.getAttribute("placeholder"), "Rechercher");
});

test("a message beside a path keeps the path's value", async () => {
  catalogs();
  const host = await draw('<p title="{MESSAGES.Save} {who}"></p>', { who: "Ada" });
  const p = host.querySelector("p");
  assert.equal(p.getAttribute("title"), "Save Ada");

  setLocale("fr");
  assert.equal(p.getAttribute("title"), "Enregistrer Ada");
});

test("a page's own {path} bindings are untouched by a locale change", async () => {
  catalogs();
  const controller = { count: 1 };
  const host = await draw("<p>{count} {MESSAGES.Save}</p>", controller);
  assert.equal(host.textContent, "1 Save");

  setLocale("fr");
  assert.equal(host.textContent, "1 Enregistrer");

  controller.count = 2;
  assert.equal(host.textContent, "2 Enregistrer");
});

test("an orphaned node is dropped rather than written to for ever", async () => {
  catalogs();
  const host = await draw("<p>{MESSAGES.Save}</p>");
  assert.equal(MESSAGES.bound.size, 1);

  // Orphaned, not merely detached. That is `refresh`'s rule for `{path}`
  // bindings and this follows it: a view may be drawn before it is put in the
  // document — that is what an `outlet` handed to a controller is — and a node
  // with a parent may still be on its way in.
  host.querySelector("p").childNodes[0].remove();
  setLocale("fr");

  assert.equal(MESSAGES.bound.size, 0, "the entry was pruned as it was found gone");
});

test("a component's own strings follow the locale too", async () => {
  catalogs();
  MESSAGES.catalogs.fr["Clear search"] = "Effacer";

  const { Component } = await import("../src/js/core/runtime/mosaic.js");
  const { h, mount } = await import("../src/js/core/runtime/mosaic.js");

  // What a framework component does: its strings are its own, drawn by it
  // rather than by any application's markup.
  class Field extends Component {
    draw() {
      return h("button", { "aria-label": this.message("Clear search") });
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Field, host, {});
  const button = host.querySelector("button");
  assert.equal(button.getAttribute("aria-label"), "Clear search");

  setLocale("fr");
  assert.equal(
    host.querySelector("button").getAttribute("aria-label"),
    "Effacer",
    "reading a message is what makes the component follow the locale",
  );
});

test("a message with something in it is filled in at the draw", async () => {
  catalogs();
  MESSAGES.catalogs.fr["{n} selected"] = "{n} sélectionnés";

  const { Component, h, mount } = await import("../src/js/core/runtime/mosaic.js");

  class Count extends Component {
    draw() {
      return h("span", null, this.message("{n} selected", { n: 3 }));
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Count, host, {});
  assert.equal(host.textContent, "3 selected");

  setLocale("fr");
  assert.equal(host.textContent, "3 sélectionnés");
});

test("what the reader typed survives a change of language", async () => {
  catalogs();
  const host = await draw(
    '<p>{MESSAGES.WelcomeBack}</p><input placeholder="{MESSAGES.Search}"/>',
  );
  const input = host.querySelector("input");
  input.value = "Ada";

  setLocale("fr");

  // The labels change and nothing else does. This is the whole reason a locale
  // change writes the messages where they stand rather than mounting the page
  // again: remounting would take the field, what is in it, and the caret with
  // it — at the moment the reader is using them.
  assert.equal(input.value, "Ada");
  assert.equal(input.getAttribute("placeholder"), "Rechercher");
  assert.equal(host.querySelector("p").textContent, "Bon retour");
  assert.equal(host.querySelector("input"), input, "the same element, not a new one");
});

test("a drawn-but-not-yet-inserted node still keeps up with the locale", async () => {
  catalogs();
  const host = await draw("<p>{MESSAGES.Save}</p>");
  const p = host.querySelector("p");

  // Taken out of the document, but its text node still belongs to it — the
  // case the rule above is careful about.
  p.remove();
  setLocale("fr");

  assert.equal(p.textContent, "Enregistrer");
});
