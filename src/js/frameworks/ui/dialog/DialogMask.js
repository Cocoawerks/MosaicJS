// DialogMask: the one shared overlay that dims the page behind everything modal.
//
// One overlay we own rather than each `<dialog>`'s own `::backdrop`, for two
// reasons: stacked modals would otherwise dim twice over, and a backdrop is
// destroyed the moment its dialog closes, so a modal opening straight after
// another would flash the dim off and on. This one lingers.
//
// Nothing outside the framework calls it: a modal Dialog raises it as it
// opens and drops it as it closes.
import "./dialog.css";

/**
 * How long the mask stays after the last modal closes, so a modal opened right
 * behind it reuses the mask rather than flashing it. `LINGER_MS` in Java.
 */
const LINGER_MS = 36;

/** How many modals are up. The mask stays while any are. */
let openCount = 0;

/** @type {Element|null} The overlay itself, made once and kept. */
let maskElement = null;

/** @type {ReturnType<typeof setTimeout>|null} */
let hideTimer = null;

/** Raise the mask for a modal that is opening, or keep it up. */
export function showMask() {
  openCount += 1;
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  ensure().classList.add("is-visible");
}

/** Account for a modal that has closed, and drop the mask after the last one. */
export function scheduleHideMask() {
  openCount = Math.max(0, openCount - 1);
  if (openCount !== 0) return;

  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (openCount === 0) maskElement?.classList.remove("is-visible");
  }, LINGER_MS);
}

/** How many modals the mask is currently counting — what the tests read. */
export function maskCount() {
  return openCount;
}

/**
 * The overlay, made on first use and kept for the life of the page.
 *
 * It is appended to the body rather than drawn by a component: it belongs to no
 * one dialog, and a dialog that made it would take it away again when it went.
 */
function ensure() {
  if (maskElement) return maskElement;

  maskElement = document.createElement("div");
  maskElement.setAttribute("class", "v-Dialog-mask");
  // Decoration only — a modal dialog captures presses itself, so the mask has
  // nothing to say to a reader and stays out of the accessibility tree.
  maskElement.setAttribute("aria-hidden", "true");
  document.body.appendChild(maskElement);
  return maskElement;
}
