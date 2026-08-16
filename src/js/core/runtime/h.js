// Creating a vnode — what compiled markup calls for every element.
import { flatten } from "./private/flatten.js";

/**
 * Create a vnode. `type` is a tag name, `Fragment`, or a component function.
 * Children are variadic and may be nested arrays (each-blocks produce arrays).
 */
export function h(type, props, ...children) {
  return { type, props: props || {}, children: flatten(children) };
}
