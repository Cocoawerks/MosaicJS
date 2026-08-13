// Registering a component's stylesheet, once per page.

const injected = new Set();

/**
 * Register a component's scoped CSS once per page, keyed by its scope hash.
 * Called at module scope by every compiled component that has a `<style>`.
 */
export function addStyles(hash, css) {
    if (typeof document === "undefined" || injected.has(hash)) return;
    injected.add(hash);
    const style = document.createElement("style");
    style.setAttribute("data-mosaic", hash);
    style.textContent = css;
    document.head.appendChild(style);
}
