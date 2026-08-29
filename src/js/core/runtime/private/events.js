// The DOM events a component can handle, and the method that handles each.
//
// Its own module rather than Component's, because the settings machinery has
// to know these names too — a setting may not be called after one of them —
// and Component is what that machinery is for.
/**
 * Every DOM event a component can handle, mapped to the method name that
 * handles it. Implement `pointerDown(event)` and the component is wired to
 * "pointerdown" automatically — no `action` attribute and no `on` prefix.
 *
 * A method here is claimed by the event system, so a component must not use
 * one of these names for anything else.
 */
export const BROWSER_EVENTS = Object.freeze({
  // pointer
  click: "click",
  dblclick: "dblClick",
  auxclick: "auxClick",
  contextmenu: "contextMenu",
  pointerdown: "pointerDown",
  pointerup: "pointerUp",
  pointermove: "pointerMove",
  pointerenter: "pointerEnter",
  pointerleave: "pointerLeave",
  pointerover: "pointerOver",
  pointerout: "pointerOut",
  pointercancel: "pointerCancel",
  gotpointercapture: "gotPointerCapture",
  lostpointercapture: "lostPointerCapture",
  // mouse
  mousedown: "mouseDown",
  mouseup: "mouseUp",
  mousemove: "mouseMove",
  mouseenter: "mouseEnter",
  mouseleave: "mouseLeave",
  mouseover: "mouseOver",
  mouseout: "mouseOut",
  wheel: "wheel",
  // touch
  touchstart: "touchStart",
  touchend: "touchEnd",
  touchmove: "touchMove",
  touchcancel: "touchCancel",
  // keyboard
  keydown: "keyDown",
  keyup: "keyUp",
  keypress: "keyPress",
  // focus
  focus: "focus",
  blur: "blur",
  focusin: "focusIn",
  focusout: "focusOut",
  // form
  input: "input",
  beforeinput: "beforeInput",
  change: "change",
  submit: "submit",
  reset: "reset",
  invalid: "invalid",
  select: "select",
  // drag and drop
  dragstart: "dragStart",
  drag: "drag",
  dragend: "dragEnd",
  dragenter: "dragEnter",
  dragover: "dragOver",
  dragleave: "dragLeave",
  drop: "drop",
  // clipboard
  copy: "copy",
  cut: "cut",
  paste: "paste",
  // scrolling and media
  scroll: "scroll",
  scrollend: "scrollEnd",
  load: "load",
  error: "error",
  // animation
  animationstart: "animationStart",
  animationend: "animationEnd",
  animationiteration: "animationIteration",
  transitionstart: "transitionStart",
  transitionend: "transitionEnd",
  transitioncancel: "transitionCancel",
});

/** The event a handler method is the handler for — `BROWSER_EVENTS` backwards. */
const EVENT_FOR_METHOD = new Map(
  Object.entries(BROWSER_EVENTS).map(([type, method]) => [method, type]),
);

/**
 * Which of these events a class handles, worked out once per class.
 *
 * `bindEvents` runs after every draw, and asking each of the sixty-odd names
 * above whether the component implements it — for every root node, every time —
 * is a cost that answers the same each time: what a class implements is fixed
 * when the class is defined. So the answer is kept against the prototype, and
 * a redraw looks it up rather than working it out.
 */
const CLASS_EVENTS = new WeakMap();

function classEvents(proto) {
  let pairs = CLASS_EVENTS.get(proto);
  if (pairs) return pairs;

  pairs = [];
  for (const type in BROWSER_EVENTS) {
    const method = BROWSER_EVENTS[type];
    if (typeof proto[method] === "function") pairs.push([type, method]);
  }
  CLASS_EVENTS.set(proto, pairs);
  return pairs;
}

/**
 * The events `instance` handles, as `[type, method]` pairs.
 *
 * Its class's, plus any it holds itself. The second is not an afterthought: a
 * handler written as a class field — `click = (event) => {...}` — is a property
 * of the instance and not of the prototype, so a per-class answer alone would
 * miss it and the component would never be wired up. Its own properties are
 * few, and with the runtime's own among them non-enumerable (see internal.js)
 * they are only what the component actually holds, so asking is cheap.
 *
 * @param {object} instance The component.
 * @returns {Array<[string, string]>} Event type and the method handling it.
 */
export function handledEvents(instance) {
  const pairs = classEvents(Object.getPrototypeOf(instance));

  let own = null;
  for (const name of Object.keys(instance)) {
    const type = EVENT_FOR_METHOD.get(name);
    if (type === undefined) continue;
    if (typeof instance[name] !== "function") continue;
    // Already counted: a field shadowing a method of the same name is one
    // handler, and binding it twice would run it twice per event.
    if (pairs.some(([, method]) => method === name)) continue;
    (own ??= []).push([type, name]);
  }

  return own ? [...pairs, ...own] : pairs;
}
