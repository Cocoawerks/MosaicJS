// Reading back every stylesheet the page has injected.

/** Escape hatch for server-side or string rendering of a page's CSS. */
export function collectStyles() {
  return [...document.querySelectorAll("style[data-mosaic]")]
    .map((s) => s.textContent)
    .join("\n");
}
