// Visual intent: the shared vocabulary of faces a component can wear — a
// primary call to action, a danger, a success. Buttons and snackbars both draw
// against it, so it lives here rather than in either of them.

/** Visual intent (lower-cased, as its toString() does). */
export const Intent = Object.freeze({
  DEFAULT: "default",
  PRIMARY: "primary",
  DANGER: "danger",
  SUCCESS: "success",
  WARNING: "warning",
  INFO: "info",
  INVERSE: "inverse",
});

export default Intent;
