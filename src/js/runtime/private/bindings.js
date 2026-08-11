// The registry behind `{path}` bindings: where they are recorded, and how a
// path is read off a controller.

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
    .map((p) => (typeof p === "string" ? p : display(readPath(controller, p.path))))
    .join("");
}

export function track(controller, entry) {
  if (!Object.prototype.hasOwnProperty.call(controller, BINDINGS)) {
    Object.defineProperty(controller, BINDINGS, { value: [], enumerable: false });
  }
  controller[BINDINGS].push(entry);
}
