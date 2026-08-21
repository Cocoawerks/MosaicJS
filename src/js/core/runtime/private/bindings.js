// The registry behind `{path}` bindings: where they are recorded, how a path is
// read off a controller, and how assigning to one gets back to the DOM.

import { refresh } from "../refresh.js";
import { observe } from "./observe.js";

/**
 * Where a controller's live bindings are recorded (non-enumerable).
 * Registered globally so every module names the same symbol.
 */
export const BINDINGS = Symbol.for("mosaic.bindings");

export function readPath(controller, path) {
  let value = controller;
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

export function attrValue(parts, controller) {
  return parts
    .map((p) =>
      typeof p === "string" ? p : display(readPath(controller, p.path)),
    )
    .join("");
}

/**
 * One notifier per controller, so observing the same property twice registers
 * one callback rather than two.
 *
 * `observe` keeps its callbacks in a Set, which only de-duplicates something
 * that is the same function each time. A fresh closure per registration was
 * harmless while a view drew once and tracked its bindings once; a view that
 * redraws tracks them again on every draw, and the set would grow by one each
 * time — then run every one of them on the next change. Two thousand redraws
 * was two thousand notifiers and a heap out of memory.
 *
 * @type {WeakMap<object, Function>}
 */
const notifiers = new WeakMap();

export function notifierFor(controller) {
  let notify = notifiers.get(controller);
  if (!notify) {
    notify = () => refresh(controller);
    notifiers.set(controller, notify);
  }
  return notify;
}

export function track(controller, entry) {
  if (!Object.prototype.hasOwnProperty.call(controller, BINDINGS)) {
    Object.defineProperty(controller, BINDINGS, {
      value: [],
      enumerable: false,
    });
  }
  controller[BINDINGS].push(entry);

  // Binding to `{count}` is what makes `count` worth watching, so this is where
  // it becomes observable — nothing has to declare it, and a property nobody
  // binds to stays an ordinary one.
  const paths =
    entry.kind === "text" ? [entry.path] : entry.parts.map((p) => p.path);
  for (const path of paths) {
    if (path)
      observe(controller, path.split(".")[0], notifierFor(controller));
  }
}
