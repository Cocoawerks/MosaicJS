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
