// The registry behind `{path}` bindings: where they are recorded, how a path is
// read off an owner, and how assigning to one gets back to the DOM.

import { MESSAGES } from "../Messages.js";
import { refresh } from "./refresh.js";
import { derivedKeys, observe } from "./observe.js";
import { setAttribute } from "./props.js";

/**
 * Where an owner's live bindings are recorded (non-enumerable).
 * Registered globally so every module names the same symbol.
 */
export const BINDINGS = Symbol.for("mosaic.bindings");

/**
 * The same bindings, indexed by the property each one reads: `Map<key,
 * Set<entry>>`.
 *
 * What it is for is telling one assignment from another. Every observed
 * property used to share a single callback — `() => refresh(owner)` — and
 * refresh re-reads *every* binding the owner has. So an interface showing eight
 * hundred values did eight hundred reads and eight hundred DOM comparisons each
 * time any one of them was assigned, and the cost of changing a name grew with
 * how much else happened to be on the interface. Measured, it was linear: 1.8µs per
 * assignment at ten bindings and 91µs at eight hundred.
 *
 * With this, `count` reaches the nodes that read `count`.
 */
const BY_KEY = Symbol.for("mosaic.bindingsByKey");

/**
 * The properties that can only be answered by drawing the view again, rather
 * than by writing a value back into a node.
 *
 * A bound prop — `<Button text="{label}"/>` — is one. What a Button does with
 * `text` is the Button's own and there is nothing in the DOM to rewrite, so the
 * markup has to be run again to work it out. `bindProp` says so, here, per
 * property: the compiler already decides this per *file* (`redraws`, see
 * codegen), and this is the same question asked one property at a time. A file
 * with one bound prop among fifty text bindings redrew for all fifty.
 *
 * Never cleared. Markup has no conditionals and no loops — see parser.js — so
 * which properties feed a prop is fixed by the file and cannot change between
 * one drawing and the next.
 */
const VIEW_KEYS = Symbol.for("mosaic.bindingsViewKeys");

/** The `Map<key, Set<entry>>` for `owner`, made if it has none. */
function indexFor(owner) {
  if (!Object.prototype.hasOwnProperty.call(owner, BY_KEY)) {
    Object.defineProperty(owner, BY_KEY, {
      value: new Map(),
      enumerable: false,
    });
  }
  return owner[BY_KEY];
}

/**
 * Say that `key` can only be answered by drawing the view again.
 * @internal
 */
export function needsRedrawFor(owner, key) {
  if (!Object.prototype.hasOwnProperty.call(owner, VIEW_KEYS)) {
    Object.defineProperty(owner, VIEW_KEYS, {
      value: new Set(),
      enumerable: false,
    });
  }
  owner[VIEW_KEYS].add(key);
}

/**
 * Drop every binding an owner holds.
 *
 * Both registers together: a redraw registers its bindings again, and an index
 * left behind would point at entries whose nodes are gone. The one place that
 * empties them, so the two cannot drift apart.
 */
export function resetBindings(owner) {
  if (Object.prototype.hasOwnProperty.call(owner, BINDINGS))
    owner[BINDINGS].length = 0;
  if (Object.prototype.hasOwnProperty.call(owner, BY_KEY))
    owner[BY_KEY].clear();
}

/**
 * Write one binding's value into the node holding it.
 *
 * The single place that says what bringing a binding up to date means, shared
 * by the whole-owner pass in refresh.js and the per-property one here.
 *
 * @returns {boolean} Whether the node is still in the document. A binding whose
 *   node has gone is dead and its caller drops it.
 */
export function writeEntry(owner, entry) {
  if (!entry.node.isConnected && entry.node.parentNode === null) return false;

  if (entry.kind === "text") {
    const next = display(readPath(owner, entry.path));
    if (entry.node.textContent !== next) entry.node.textContent = next;
  } else {
    const next = attrValue(entry.parts, owner);
    if (entry.node.getAttribute(entry.name) !== next) {
      setAttribute(entry.node, entry.name, next);
    }
  }
  return true;
}

export function readPath(owner, path) {
  let value = owner;
  for (const key of path.split(".")) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

/** Render a bound value the way a text node should show it. */
export function display(value) {
  return value === null || value === undefined ? "" : String(value);
}

export function attrValue(parts, owner) {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      // A part naming a message is looked up rather than read off the
      // controller: `placeholder="{MESSAGES.Search}"`, and the mixed case
      // `title="{MESSAGES.SavedAt} {time}"`.
      if (p.key !== undefined) return MESSAGES.get(p.key);
      return display(readPath(owner, p.path));
    })
    .join("");
}

/**
 * One notifier per owner *and property*, so observing the same property
 * twice registers one callback rather than two.
 *
 * `observe` keeps its callbacks in a Set, which only de-duplicates something
 * that is the same function each time. A fresh closure per registration was
 * harmless while a view drew once and tracked its bindings once; a view that
 * redraws tracks them again on every draw, and the set would grow by one each
 * time — then run every one of them on the next change. Two thousand redraws
 * was two thousand notifiers and a heap out of memory.
 *
 * Per property rather than per owner, which is what lets one assignment
 * reach only what reads it. The memoising is what keeps that safe: the answer
 * for a given property is the same function for ever, so re-tracking on every
 * draw still registers one.
 *
 * @type {WeakMap<object, Map<string, Function>>}
 */
const notifiers = new WeakMap();

export function notifierFor(owner, key) {
  let byKey = notifiers.get(owner);
  if (!byKey) {
    byKey = new Map();
    notifiers.set(owner, byKey);
  }
  let notify = byKey.get(key);
  if (!notify) {
    notify = () => refreshKey(owner, key);
    byKey.set(key, notify);
  }
  return notify;
}

/**
 * Bring up to date whatever reads `key`, and nothing else.
 *
 * Two ways, and which one is taken depends on what reads it. A property a bound
 * prop is worked out from can only be answered by running the markup again, so
 * that falls back to the whole-owner pass — see `VIEW_KEYS`. Anything else
 * is text and attributes, which are written straight back into the nodes
 * holding them.
 */
function refreshKey(owner, key) {
  if (owner[VIEW_KEYS]?.has(key)) {
    refresh(owner);
    return;
  }

  const entries = owner[BY_KEY]?.get(key);
  if (!entries || entries.size === 0) return;

  // Copied: writing a value may remove a node, and a dead entry is dropped as
  // it is found rather than left for the whole-owner pass to compact.
  for (const entry of [...entries]) {
    if (!writeEntry(owner, entry)) entries.delete(entry);
  }
}

export function track(owner, entry) {
  if (!Object.prototype.hasOwnProperty.call(owner, BINDINGS)) {
    Object.defineProperty(owner, BINDINGS, {
      value: [],
      enumerable: false,
    });
  }
  owner[BINDINGS].push(entry);

  // Binding to `{count}` is what makes `count` worth watching, so this is where
  // it becomes observable — nothing has to declare it, and a property nobody
  // binds to stays an ordinary one.
  const paths =
    entry.kind === "text" ? [entry.path] : entry.parts.map((p) => p.path);

  // Every property this one binding reads, gathered before any is registered:
  // an attribute made of several `{path}` pieces reads more than one, and a
  // derived value reads whatever its getter read rather than itself.
  const keys = new Set();
  for (const path of paths) {
    if (!path) continue;
    const head = path.split(".")[0];

    // A derived value is not assigned, so watching it watches nothing: what a
    // `{formatted}` depends on is whatever its getter read. Asked before the
    // property is observed, since observing plain state replaces it with an
    // accessor of the runtime's own — one that derives nothing, and would be
    // walked for its reads for no purpose.
    for (const key of derivedKeys(owner, head)) keys.add(key);

    keys.add(head);
  }

  // Recorded against each of them, so an assignment finds this binding without
  // walking the ones that have nothing to do with it.
  const index = indexFor(owner);
  for (const key of keys) {
    let entries = index.get(key);
    if (!entries) {
      entries = new Set();
      index.set(key, entries);
    }
    entries.add(entry);
    observe(owner, key, notifierFor(owner, key));
  }

  // An attribute with a message in it is the messages' business as well as the
  // owner's: nothing the owner holds changes when the locale does,
  // so it is registered where a locale change can find it. Registered here
  // rather than beside the render, because a patch re-tracks the same
  // attribute and this is the one place both go through.
  if (entry.kind === "attr" && entry.parts.some((p) => p.key !== undefined)) {
    MESSAGES._bind({
      node: entry.node,
      attr: entry.name,
      render: () => attrValue(entry.parts, owner),
    });
  }
}
