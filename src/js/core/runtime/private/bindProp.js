// `<Button text="{label}"/>` compiles to a call to this.
// An attribute of the markup itself is a binding the runtime keeps up to date
// afterwards — `bindAttr` makes one of those. A component's prop is not part of
// the markup: what a Button does with `text` is the Button's own, and there is
// nothing in the DOM to rewrite when the value changes.
// So a bound prop is read rather than declared: the value is taken now and
// handed over as the plain thing it is. What makes it stay right is that the
// view redraws — reading the path here is also what marks it worth watching, so
// assigning to it draws the view again and the prop is worked out afresh.
import {
  display,
  needsRedrawFor,
  notifierFor,
  readPath,
} from "./bindings.js";
import { MESSAGES } from "../Messages.js";
import { derivedKeys, observe } from "./observe.js";

/**
 * The value of a bound prop, and the mark that says to draw again when it
 * changes.
 *
 * `parts` is what an attribute is made of — literals and `{path}` pieces — the
 * same shape `bindAttr` takes. A prop that is one binding and nothing else is
 * the value itself, so a number stays a number and an object stays an object;
 * anything with text around it is that text with the values in it.
 */
export function bindProp(owner, parts) {
  // A literal piece is a plain string and a bound one is `{path}`, which is
  // the shape `attrValue` reads too. A `{MESSAGES.Key}` piece carries a key
  // instead, and there is nothing on the owner to watch for it: what a
  // message says changes with the locale, and that is not this owner's
  // business — see `MESSAGES._retranslate`.
  for (const part of parts) {
    if (typeof part === "string") continue;
    if (part.key !== undefined) {
      MESSAGES._redrawOnLocaleChange(owner);
      continue;
    }
    const head = part.path.split(".")[0];
    // What a derived value derives from, as `track` watches it for a binding
    // in the markup: a getter is never assigned, so watching it alone watches
    // nothing. Asked before the property is observed — see the same call there.
    for (const key of derivedKeys(owner, head)) {
      // A prop cannot be written back into a node the way text and attributes
      // can: what a Button does with `text` is the Button's own. So this
      // property is one the view has to be drawn again for, and it says so
      // rather than every property on the owner being treated that way.
      needsRedrawFor(owner, key);
      observe(owner, key, notifierFor(owner, key));
    }
    needsRedrawFor(owner, head);
    observe(owner, head, notifierFor(owner, head));
  }

  if (parts.length === 1 && typeof parts[0] !== "string") {
    const only = parts[0];
    return only.key !== undefined
      ? MESSAGES.get(only.key)
      : readPath(owner, only.path);
  }
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.key !== undefined) return MESSAGES.get(part.key);
      return display(readPath(owner, part.path));
    })
    .join("");
}











