// The controller behind main.mib, and the whole of the counter's behaviour:
// the page's state, the values its {bindings} read, and the methods its
// actions fire.
//
// A controller is a plain object — it extends nothing and the runtime asks
// nothing of it. `{count}` and `{status}` are read off it by name and `action=`
// calls its methods. Binding to a property is what makes it observable, so
// assigning to `count` is all it takes to update the DOM.
export default class AppController {
  constructor({ title = "Counter App", limit = 3 } = {}) {
    this.title = title;
    this.limit = limit;
    this.count = 0;
  }

  /** Read by `styleName="value {status}"`, so the class follows the count. */
  get status() {
    return this.count >= this.limit ? "high" : "";
  }

  increment() {
    this.count += 1;
  }

  decrement() {
    this.count -= 1;
  }
}
