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

export { coerceProps, coerceValue } from "./private/coerce.js";
// What a child's declared setting resolves to, for a parent reading it off
// the vnode rather than through the accessor — a Menu asking an item
// whether it is a rule, and the like.
export { settingValue } from "./private/settings.js";
export { Fragment } from "./private/Fragment.js";
export { h } from "./private/h.js";
export { render } from "./private/render.js";
export { mount } from "./private/mount.js";
export { redraw } from "./private/redraw.js";
export { refresh } from "./private/refresh.js";
// Binding a property of one thing to a property of another — a control to a
// controller, a control to a control. One way each; two facing make it two.
export { bind, bindTwoWay, canPush, observeKey } from "./bind.js";
// A bindable array — a JavaScript array with `objects` and `count` other things
// can bind to, as Cocoa's NSArrayController has.
export {ArrayController} from "./ArrayController.js";
export { bindText } from "./private/bindText.js";
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
export { bindAttr } from "./private/bindAttr.js";
export { bindProp } from "./private/bindProp.js";
export { clearBindings } from "./private/clearBindings.js";
// Announcing something to whoever cares, without the two ends knowing each
// other — what a binding cannot do across a distance.
export { NotificationCenter, notifications } from "./NotificationCenter.js";
// Talking to a server: `fetch` with the JSON and the status checking that
// every call otherwise writes out again.
export { Request, RequestError } from "./request.js";
export { addStyles } from "./private/addStyles.js";
export { collectStyles } from "./private/collectStyles.js";
export { MosaicApplication } from "./MosaicApplication.js";
// Reading a value a server-rendered page handed the app up front through a
// `<meta name="…">` tag — a CSRF token, the signed-in user.
export { meta } from "./meta.js";
