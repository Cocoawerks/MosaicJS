// The controller behind main.mib: the page's state, the values its {bindings}
// read, and the methods its actions fire.
//
// A controller is a plain object — it extends nothing and the runtime asks
// nothing of it. Properties are read by name, `action=` calls methods, and
// `mount()` wires the rendered view onto `this.view`, so a state change is
// pushed to the DOM with `this.view.needsDisplay()`.
export default class AppController {
  constructor() {
      this.color = "#ff0000";
  }


  swap() {
    this.color = this.color === "#000" ? "#ff0000" : "#000";
  }
}
