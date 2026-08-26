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
// Binding a property of one thing to a property of another — a control to a
// controller, a control to a control. One way each; two facing make it two.
export { bind, bindTwoWay, canPush, observeKey } from "./bind.js";
export { bindText } from "./bindText.js";
// What the application says, in whichever language it is read in. `MESSAGES` is
// reserved in markup: `{MESSAGES.save}` is a lookup here rather than a read off
// the controller, keyed by a short name whose text is in locales/default.json.
export {
  Messages,
  MESSAGES,
  bindMessage,
  locale,
  locales,
  setLocale,
} from "./Messages.js";
export { bindAttr } from "./bindAttr.js";
export { bindProp } from "./bindProp.js";
export { clearBindings } from "./clearBindings.js";
// Announcing something to whoever cares, without the two ends knowing each
// other — what a binding cannot do across a distance.
export { NotificationCenter, notifications } from "./NotificationCenter.js";
// Talking to a server: `fetch` with the JSON and the status checking that
// every call otherwise writes out again.
export { Request, RequestError } from "./request.js";
export { addStyles } from "./addStyles.js";
export { collectStyles } from "./collectStyles.js";
export { MosaicApplication } from "./MosaicApplication.js";
// Reading a value a server-rendered page handed the app up front through a
// `<meta name="…">` tag — a CSRF token, the signed-in user.
export { meta } from "./meta.js";
