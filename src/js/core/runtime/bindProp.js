// `<Button text="{label}"/>` compiles to a call to this.
//
// An attribute of the markup itself is a binding the runtime keeps up to date
// afterwards — `bindAttr` makes one of those. A component's prop is not part of
// the markup: what a Button does with `text` is the Button's own, and there is
// nothing in the DOM to rewrite when the value changes.
//
// So a bound prop is read rather than declared: the value is taken now and
// handed over as the plain thing it is. What makes it stay right is that the
// view redraws — reading the path here is also what marks it worth watching, so
// assigning to it draws the view again and the prop is worked out afresh.
import { display, notifierFor, readPath } from "./private/bindings.js";
import { observe } from "./private/observe.js";

/**
 * The value of a bound prop, and the mark that says to draw again when it
 * changes.
 *
 * `parts` is what an attribute is made of — literals and `{path}` pieces — the
 * same shape `bindAttr` takes. A prop that is one binding and nothing else is
 * the value itself, so a number stays a number and an object stays an object;
 * anything with text around it is that text with the values in it.
 */
export function bindProp(controller, parts) {
  // A literal piece is a plain string and a bound one is `{path}`, which is
  // the shape `attrValue` reads too.
  for (const part of parts) {
    if (typeof part === "string") continue;
    observe(controller, part.path.split(".")[0], notifierFor(controller));
  }

  if (parts.length === 1 && typeof parts[0] !== "string") {
    return readPath(controller, parts[0].path);
  }
  return parts
    .map((part) =>
      typeof part === "string" ? part : display(readPath(controller, part.path)),
    )
    .join("");
}











