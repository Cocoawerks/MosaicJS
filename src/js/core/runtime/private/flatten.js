// Children arrive nested (a list renders an array) and may hold blanks.

/** Flatten a child list, dropping null, undefined and booleans. */
export function flatten(children, out = []) {
  for (const child of children) {
    if (Array.isArray(child)) flatten(child, out);
    else if (
      child !== null &&
      child !== undefined &&
      child !== false &&
      child !== true
    ) {
      out.push(child);
    }
  }
  return out;
}
