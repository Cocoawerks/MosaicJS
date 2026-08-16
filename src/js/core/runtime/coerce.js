// Props as the values they name.
//
// A `.mib` file states props as text: `enabled="false"` is the string
// "false", which is truthy, so a component reading it would see a disabled
// control as enabled. Rather than have every boolean getter defend itself, a
// component's props are read once on the way in and `"true"` and `"false"`
// become the booleans they spell.
//
// Only those two words. `"0"`, `"no"` and `"off"` are left as they are: this
// runs over every prop a component is given, not only the ones a control
// means as booleans, and a prop whose value is legitimately the text "no"
// must survive. A bare `<Button toggle>` never reaches here — the compiler
// emits it as the boolean true already.

/**
 * One prop's value.
 *
 * @param {*} value What the prop holds.
 * @returns {*} The value, with "true" and "false" as booleans.
 */
export function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/**
 * A component's props, with the boolean words read as booleans.
 *
 * The same object is returned when there was nothing to convert, so the usual
 * case allocates nothing and a redraw's prop comparison still sees what it
 * saw before.
 *
 * @param {object} props The props a component was given.
 * @returns {object} The props, coerced.
 */
export function coerceProps(props) {
  if (!props) return props;

  let coerced = null;
  for (const name in props) {
    const value = props[name];
    if (value !== "true" && value !== "false") continue;
    coerced ??= { ...props };
    coerced[name] = value === "true";
  }
  return coerced ?? props;
}
