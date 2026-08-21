/**
 * Mosaic runtime.
 *
 * Compiled components import `h`, `Fragment` and `addStyles` from here; the
 * compiler never inlines any of this code into its output. Each export lives
 * in its own module beside this one — this file is the public surface, and the
 * single place everything reaches `Component` through, so the class is never
 * loaded twice.
 *
 *   import Main from "./build/main.js";
 *   import { mount } from "./src/js/core/runtime/mosaic.js";
 *   mount(Main, document.body, {}, controller);
 */

export { Component, BROWSER_EVENTS } from "./Component.js";

export { coerceProps, coerceValue } from "./coerce.js";
// What a child's declared setting resolves to, for a parent reading it off
// the vnode rather than through the accessor — a Menu asking an item
// whether it is a rule, and the like.
export { settingValue } from "./private/settings.js";
export { Fragment } from "./Fragment.js";
export { h } from "./h.js";
export { render } from "./render.js";
export { mount } from "./mount.js";
export { redraw } from "./redraw.js";
export { refresh } from "./refresh.js";
export { bindText } from "./bindText.js";
export { bindAttr } from "./bindAttr.js";
export { bindProp } from "./bindProp.js";
export { clearBindings } from "./clearBindings.js";
export { addStyles } from "./addStyles.js";
export { collectStyles } from "./collectStyles.js";
export { MosaicApplication } from "./MosaicApplication.js";
