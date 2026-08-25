// Messages — the strings an application says, in whichever language it is
// being read in.
//
//   <Button text="{MESSAGES.save}"/>
//   <h1>{MESSAGES.welcomeBack}</h1>
//
// `MESSAGES` is reserved in `.ib.xml` markup: a binding whose path starts with
// it is not read from the controller at all, but looked up here. Reserved, and
// spelled in capitals, because `messages` is a perfectly ordinary thing for a
// controller to hold — a chat log, a list of validation messages — and a
// collision would be silent: the binding would read the application's own
// array, find no `save` on it, and draw nothing.
//
// A key is a short name — `save`, `openPicture`, `dialog.close` — not the
// sentence it stands for. The message each key stands for lives in
// `locales/default.json` (usually English), and every other language beside it.
//
// A key resolves in three steps: the active locale's catalog, then the default
// catalog (`default.json`), then the key itself. So `{MESSAGES.save}` draws the
// default text wherever a locale has no translation of its own, and a key
// nobody has written a default for yet draws its own name rather than a hole in
// the page. A single-word key that is already its own English — a framework's
// `"Close"` — needs no default at all: it falls through to itself.
//
// Switching locale is what the theme does with a stylesheet: every translated
// string in the document is written again, and nothing is redrawn and no state
// is touched. A form half filled in stays half filled in; the labels change
// around it.

import { refresh } from "./refresh.js";

/**
 * How a `{name}` inside a message is filled in — see {@link Messages#format}.
 *
 * Letters as Unicode has them, not as ASCII does. A key is written in English
 * and so names its places in English, but a *translation* need not: a message
 * that reads `Здравствуйте, {имя}.` is a translator writing the placeholder in
 * the language they are writing, which is the obvious thing to do and left the
 * name standing there in the finished sentence when `\w` was all this matched.
 */
const PLACEHOLDER = /\{([\p{L}\p{N}_]+)\}/gu;

export class Messages {
  /**
   * @param {object} [catalogs] `{locale: {key: translation}}`. The locale a
   *   key is missing from falls back to the default catalog, then to the key.
   * @param {string} [locale] Which one to start in.
   * @param {object} [defaults] `{key: message}` — the default (usually English)
   *   text of each key, from `locales/default.json`. Consulted for any key the
   *   active locale does not translate. Empty when an application keys on the
   *   English itself, which is what leaves the fallback the key.
   */
  constructor(catalogs = {}, locale = "en", defaults = {}) {
    this.catalogs = catalogs;
    this._locale = locale;
    this.defaults = defaults;

    /**
     * The places in the document a message has been put, so that changing
     * locale can write them again: node -> what of it is a message. The inner
     * key is the attribute's name, or `""` for the node's own text.
     *
     * Kept per node and per attribute rather than as a list, because a patched
     * node is registered again on every redraw — the same node, the same
     * attribute, a new entry — and a list would hold one of each per draw, then
     * write them all on the next change. The map replaces instead.
     *
     * Entries live until their nodes leave the document and are dropped as
     * they are found gone, which is the bookkeeping `refresh` does for
     * `{path}` bindings and for the same reason.
     */
    this.bound = new Map();

    /**
     * Controllers whose drawing read a message, held weakly.
     *
     * A component's prop is not part of the markup — `<Button
     * text="{MESSAGES.Save}"/>` hands the Button a string, and there is no node
     * of this page's to rewrite when the locale changes. So the view is drawn
     * again instead, which works the prop out afresh. It is the same reasoning
     * `bindProp` is built on, with the locale in place of an assignment.
     *
     * Weakly, because a controller may be short-lived — a dialog opened and
     * closed a hundred times is a hundred controllers, and a set holding each
     * one for the life of the page would be a leak that only shows up in an
     * application people use for a while.
     */
    this.dependents = new Set();
    this.registered = new WeakSet();
  }

  /** The locale being read in. */
  get locale() {
    return this._locale;
  }

  /** Assigning it is `setLocale`, so either spelling works. */
  set locale(name) {
    this.setLocale(name);
  }

  /** The locales this build carries. */
  get locales() {
    return Object.keys(this.catalogs);
  }

  /**
   * What `key` says in the current locale.
   *
   * The active locale first, then the default catalog (`default.json`), then
   * the key itself — so there is no such thing as a missing message, only one
   * that is still in its default language, or one whose key is its own default.
   */
  get(key) {
    return this.catalogs[this._locale]?.[key] ?? this.defaults[key] ?? key;
  }

  /**
   * The same, with `{name}` filled in from `params`:
   *
   *   MESSAGES.get("Hello");                       // "Hello"
   *   messages.format("HelloName", {name: "Ada"}); // "Hello, Ada"
   *
   * Markup cannot call this — a `{binding}` names a value, it does not call a
   * function — so a message with something in it is worked out in a controller
   * and bound to as an ordinary property. That is the same rule as anything
   * else the markup cannot express.
   */
  format(key, params = {}) {
    return this.get(key).replace(PLACEHOLDER, (whole, name) =>
      name in params ? String(params[name]) : whole,
    );
  }

  /** Whether the current locale has a translation of its own for `key`. */
  has(key) {
    return this.catalogs[this._locale]?.[key] !== undefined;
  }

  /**
   * Take a whole set of catalogs, the locale to read them in, and the default
   * texts to fall back to (`default.json`).
   *
   * What `messages.js` calls — the module mosaic generates from the `locales`
   * an `info.json` names. It is a method rather than three assignments so that
   * calling it again is a complete swap: catalogs replaced, locale set,
   * defaults replaced, and whatever is already on the page written again.
   */
  install(catalogs, locale = this._locale, defaults = this.defaults) {
    this.catalogs = catalogs;
    this._locale = locale;
    this.defaults = defaults;
    this.retranslate();
    return this;
  }

  /** Add or replace a catalog — how a framework contributes its own strings. */
  add(locale, catalog) {
    this.catalogs[locale] = { ...this.catalogs[locale], ...catalog };
    if (locale === this._locale) this.retranslate();
    return this;
  }

  /**
   * Read the application in `name` from here on.
   *
   * Unknown locales are refused rather than quietly ignored, as `setTheme`
   * refuses an unknown theme: a name that is not in the build is a mistake in
   * the application, and one that draws every string in English is a mistake
   * that takes a while to notice.
   */
  setLocale(name) {
    if (!(name in this.catalogs)) {
      throw new Error(
        `no locale "${name}" in this build — it carries ${this.locales.join(", ")}`,
      );
    }
    this._locale = name;
    this.retranslate();
    return name;
  }

  /**
   * Remember somewhere a message was put, so a change of locale can write it
   * again. Called by the runtime as it renders; applications do not call this.
   *
   * @param {object} entry `{node, key}` for a text node, or `{node, attr,
   *   render}` for an attribute — an attribute may be part message and part
   *   `{path}`, so it hands over how to work itself out rather than a key.
   */
  bind(entry) {
    let parts = this.bound.get(entry.node);
    if (!parts) {
      parts = new Map();
      this.bound.set(entry.node, parts);
    }
    parts.set(entry.attr ?? "", entry);
    return entry;
  }

  /**
   * Remember that `controller` drew something a message decided, so a change
   * of locale draws it again. Called by `bindProp`; applications do not call
   * this.
   */
  dependOn(controller) {
    if (!controller || this.registered.has(controller)) return;
    this.registered.add(controller);
    this.dependents.add(new WeakRef(controller));
  }

  /**
   * Write every bound message again, dropping the ones whose nodes have left
   * the document.
   */
  retranslate() {
    // The views that read a message rather than declaring one. Drawn again
    // first, so that the nodes they produce are in the document before the
    // pass below writes the messages that are in them.
    for (const ref of this.dependents) {
      const controller = ref.deref();
      if (!controller) {
        this.dependents.delete(ref);
        continue;
      }
      if (typeof controller.needsDisplay === "function") {
        controller.needsDisplay();
      } else {
        refresh(controller);
      }
    }

    for (const [node, parts] of this.bound) {
      if (!node.isConnected && node.parentNode === null) {
        this.bound.delete(node);
        continue;
      }
      for (const entry of parts.values()) {
        if (entry.attr === undefined) {
          const next = this.get(entry.key);
          if (node.textContent !== next) node.textContent = next;
        } else {
          const next = entry.render();
          if (node.getAttribute(entry.attr) !== next) {
            node.setAttribute(entry.attr, next);
          }
        }
      }
    }
  }
}

/**
 * The application's messages: the one instance `{MESSAGES.…}` compiles to a
 * lookup on.
 *
 * There is one, as there is one theme, and it is here rather than passed about
 * because markup cannot pass anything — a page says `{MESSAGES.Save}` and
 * nothing else. What fills it is `messages.js`, generated into the framework
 * from the application's `locales/` the way `theme.js` is generated from its
 * themes.
 */
export const MESSAGES = new Messages();

/** Read the application in `name`. The counterpart of `setTheme`. */
export function setLocale(name) {
  return MESSAGES.setLocale(name);
}

/** Which locale is being read, and which ones this build carries. */
export function locale() {
  return MESSAGES.locale;
}

export function locales() {
  return MESSAGES.locales;
}

/**
 * Declare a `{MESSAGES.Key}` text binding — what the compiler emits for one in
 * text position, as `bindText` is what it emits for `{count}`.
 */
export function bindMessage(key) {
  return { __ibBind: "message", key };
}

export default Messages;
