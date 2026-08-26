// ProgressBar: a track that fills as work is done.
//
//   <ProgressBar value="40" outlet="upload"/>
//   <ProgressBar indeterminate/>
//
// Two kinds, and the difference is what they can say. A bar with a value says
// how far along the work is; an indeterminate one says only that it is running,
// and sweeps rather than fills — for work whose length is not known.
//
// Not a Control: there is nothing to operate. It reports nothing and takes no
// focus; it is read, like a label.
import { Component } from "mosaic";

import "./progressbar.css";

export default class ProgressBar extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `ProgressBar`. See Component.styleName.
   */
  static styleName = "v-ProgressBar";

  static props = {
    /** Whether the bar says only that work is running, not how far along. */
    indeterminate: { type: Boolean, default: false },
    /** Where the track starts. */
    minValue: { type: Number, default: 0 },
    /** Where it ends. */
    maxValue: { type: Number, default: 100 },
  };

  // --- value ---------------------------------------------------------------

  get value() {
    return this.constrain(Number(this.get("value", 0)));
  }

  set value(value) {
    this.setValue(value, false);
  }

  /**
   * Move the bar, and say whether that counts as something worth reporting.
   *
   * @param {number} value How far along the work is.
   * @param {boolean} [fireEvents] Whether to report it.
   */
  setValue(value, fireEvents = false) {
    const next = this.constrain(Number(value));
    if (next === this.value) return;

    this.set("value", next);
    // An indeterminate bar has no value to report — it is not measuring.
    if (fireEvents && !this.indeterminate) this.props.action?.(this.self, next);
  }

  constrain(value) {
    return Math.min(this.maxValue, Math.max(this.minValue, value));
  }

  // --- drawing -------------------------------------------------------------

  /**
   * How much of the track is filled, as a percentage.
   *
   * The Java version measures the track in pixels and re-measures on every
   * resize; a percentage is the same answer without the observer, and it
   * follows the track's width on its own.
   */
  get fraction() {
    const span = this.maxValue - this.minValue || 1;
    return ((this.value - this.minValue) / span) * 100;
  }

  barClasses() {
    const value = this.value;
    return [
      "v-ProgressBar",
      this.indeterminate ? "indeterminate" : null,
      // `progress` while it is under way, `complete` once it is done: the sheet
      // draws the filled end differently when it reaches the track's.
      !this.indeterminate && value > this.minValue && value < this.maxValue
        ? "progress"
        : null,
      !this.indeterminate && value >= this.maxValue ? "complete" : null,
    ];
  }

  draw() {
    const indeterminate = this.indeterminate;
    return (
      <div
        styleName={this.barClasses()}
        role="progressbar"
        aria-valuemin={indeterminate ? null : String(this.minValue)}
        aria-valuemax={indeterminate ? null : String(this.maxValue)}
        aria-valuenow={indeterminate ? null : String(this.value)}
      >
        <div style={indeterminate ? {} : { width: `${this.fraction}%` }} />
      </div>
    );
  }
}
