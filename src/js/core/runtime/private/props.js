// Applying a prop to a DOM element.

const DOM_PROPS = new Set(["value", "checked", "selected", "muted", "volume"]);

/**
 * Hand `target` to whatever the `ref`/`outlet` was: a function is called with
 * it, an object gets it as `current`. The target is a DOM node for an element
 * and the component itself for a component tag.
 */
export function applyRef(ref, target) {
  if (typeof ref === "function") ref(target);
  else if (ref && typeof ref === "object") ref.current = target;
}

export function setAttribute(el, name, value) {
  if (name === "children" || name === "key") return;

  if (name.startsWith("on") && typeof value === "function") {
    el.addEventListener(name.slice(2).toLowerCase(), value);
    return;
  }

  if (name === "ref") {
    applyRef(value, el);
    return;
  }

  if (name === "style" && value && typeof value === "object") {
    for (const key in value) {
      const v = value[key];
      if (key.startsWith("--")) el.style.setProperty(key, v);
      else el.style[key] = v;
    }
    return;
  }

  if (name === "class" || name === "className") {
    el.setAttribute("class", normalizeClass(value));
    return;
  }

  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
    return;
  }
  if (value === true) {
    el.setAttribute(name, "");
    return;
  }

  if (DOM_PROPS.has(name) && name in el) {
    el[name] = value;
    return;
  }
  el.setAttribute(name, String(value));
}

/**
 * Accepts a string, an array, or an object of `{ name: enabled }`.
 * Whitespace is collapsed, so an empty interpolation — `` `value ${status}` ``
 * with no status — yields "value" rather than "value ".
 */
function normalizeClass(value) {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  if (Array.isArray(value))
    return value.filter(Boolean).map(normalizeClass).join(" ");
  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter((k) => value[k])
      .join(" ");
  }
  return value == null || value === false ? "" : String(value);
}
