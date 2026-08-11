// A drawn Component: `draw()` returns JSX, which the compiler
// rewrites into h() calls, and needsDisplay() re-runs it. It is used from
// main.ib as <Counter/>.
import { Component } from "../../src/js/runtime/mosaic.js";

// The compiler inlines this stylesheet into an addStyles() call, so it works
// in a browser with no bundler. These selectors are global — scoping needs
// markup to attach the scope attribute to, which is a .ib feature.
import "./counter.css";

export default class Counter extends Component {
  constructor() {
    super();
    this.count = 0;
  }

  // `props` arrive from the markup that rendered this view.
  get limit() {
    return Number(this.props.limit ?? 3);
  }

  // Derived state belongs in a getter, so draw() stays declarative.
  get status() {
    return this.count >= this.limit ? "high" : "";
  }

  increment() {
    this.count += 1;
    this.needsDisplay();
  }

  decrement() {
    this.count -= 1;
    this.needsDisplay();
  }

  draw() {
    // Real JavaScript: the conditional is an expression, not template syntax.
    return (
      <div styleName="counter">
        <Button text="-" action="decrement" />
        <output styleName={`value ${this.status}`}>{this.count}</output>
        <Button text="+" intent="primary" action="increment" />
      </div>
    );
  }
}
