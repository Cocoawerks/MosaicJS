// The counter, as a component of its own.
//
// It owns its state — the page that hosts it binds nothing of the counter's —
// so `<Counter limit="3"/>` is the whole of what main.mib says about it. A
// drawn component states its markup in `draw()`; assigning to a property it
// read redraws it, which is why nothing here calls needsDisplay().
import {Component} from "mosaic";
import {Button} from "mosaic/frameworks/ui";

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
    }

    decrement() {
        this.count -= 1;
    }

    draw() {
        return (
            <div styleName="counter">
                <Button text="-" action="decrement"/>
                <output styleName={`value ${this.status}`}>{this.count}</output>
                <Button text="+" intent="primary" action="increment"/>
            </div>
        );
    }
}
