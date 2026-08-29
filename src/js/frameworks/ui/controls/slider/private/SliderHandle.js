// SliderHandle: one knob on a slider's track — the value it stands for, and the
// arithmetic that turns that value into a position and a position back into a
// value.
//
// The element is drawn by the slider, because a stylesheet is scoped to the
// module that imports it and `.v-Slider .handle` is the slider's rule. What is
// left here is the state and the sums; the slider owns the events and calls in.

/** How far the knob overhangs the end of the track, in pixels. */
export const OFFSET = 6;

/** The knob's own size, as the sheet draws it, subtracted from the run. */
const KNOB = 10;

export default class SliderHandle {
  /**
   * @param {object} slider The slider this knob belongs to.
   */
  constructor(slider) {
    this.slider = slider;
    /** The value this knob stands for. */
    this.value = -1;
    /**
     * Where the knob has been dragged to but the slider is not yet worth —
     * `null` except during a drag on a slider that is not continuous.
     *
     * A knob has to follow the pointer, or a drag shows nothing; a slider that
     * reports where the knob came to rest should not be worth every place it
     * passed through on the way. Those are two different numbers, so there are
     * two of them: this one moves with the pointer and only draws, and `value`
     * is written once, on release, by {@link SliderHandle#commit}.
     *
     * A continuous slider never sets it. There the two numbers are the same
     * number, and it goes on being the plain thing it always was.
     */
    this.pending = null;
    /** The element the slider drew for it, once it has. */
    this.element = null;
    /** Where the pointer took hold of the knob, relative to its middle. */
    this.grabOffset = { x: 0, y: 0 };
    /** Whether this knob has focus, and so wears the ring. */
    this.focused = false;
    /** Whether this knob is being worked, and so wears the pressed face. */
    this.active = false;
  }

  // --- value ---------------------------------------------------------------

  /**
   * Where the knob is, which is what it is worth unless it is mid-drag on a
   * slider that has not committed to the drag yet.
   *
   * Everything that draws or measures the knob reads this; everything that
   * asks what the slider is worth reads `value`.
   */
  get shown() {
    return this.pending ?? this.value;
  }

  /**
   * Hold a value between the bounds this knob may take — for a range slider
   * its neighbour, rather than the slider's own end.
   */
  hold(value) {
    return Math.max(
      this.slider.minValueForHandle(this),
      Math.min(this.slider.maxValueForHandle(this), value),
    );
  }

  /**
   * Take the knob to a value without the slider becoming worth it: it draws,
   * and nothing else hears anything.
   *
   * @param {number} value Where to put the knob.
   * @returns {boolean} Whether it moved.
   */
  dragTo(value) {
    const held = this.hold(value);
    if (this.pending === held) return false;
    this.pending = held;
    this.slider.handleDragging(this);
    return true;
  }

  /**
   * Make the slider worth where the knob was dragged to.
   *
   * The action is the caller's to fire — `pointerUp` reports a settled drag
   * whether or not the knob ended up anywhere new, which is what it did before
   * any of this and not a thing to change here.
   *
   * @returns {boolean} Whether the value changed.
   */
  commit() {
    if (this.pending === null) return false;
    const to = this.pending;
    // Cleared first: `setValue` draws, and drawing reads `shown`, which would
    // otherwise still be answering with the drag.
    this.pending = null;
    return this.setValue(to, false);
  }

  /** Give up a drag: the knob goes back to what the slider is worth. */
  cancel() {
    if (this.pending === null) return;
    this.pending = null;
    this.slider.handleDragging(this);
  }

  /**
   * Move the knob, and say whether that counts as the user moving it.
   *
   * The value is held between the bounds this knob may take, which for a
   * range slider is its neighbour rather than the slider's own end.
   *
   * @param {number} value Where to put it.
   * @param {boolean} [fireEvents] Whether to report the move.
   * @returns {boolean} Whether it moved at all.
   */
  setValue(value, fireEvents = false) {
    const previous = this.value;
    if (previous === value) return false;

    this.value = this.hold(value);

    this.slider.handleMoved(this, fireEvents);
    return true;
  }

  // --- position ------------------------------------------------------------

  /** Where along the track this value sits, in pixels from the near end. */
  calcPosition() {
    const { minValue, maxValue } = this.slider;
    const span = maxValue - minValue || 1;
    // Where the knob is, not what the slider is worth: mid-drag on a slider
    // that is not continuous those differ, and the knob is the one being drawn.
    const p = 1 - (maxValue - this.shown) / span;

    return this.slider.vertical
      ? Math.round((1 - p) * (this.slider.trackLength() - KNOB))
      : Math.round(p * (this.slider.trackLength() - KNOB));
  }

  /** Put the knob where its value says it belongs. */
  updatePosition() {
    if (!this.element) return;
    const at = `${this.calcPosition() + OFFSET}px`;
    if (this.slider.vertical) {
      this.element.style.top = at;
      this.element.style.left = "";
    } else {
      this.element.style.left = at;
      this.element.style.top = "";
    }
  }

  /**
   * The value a place on the track stands for, stepped to the nearest one the
   * slider allows.
   *
   * @param {number} pos Pixels from the near end.
   * @returns {number} The value there.
   */
  valueOfPosition(pos) {
    const run = this.slider.trackLength() - 2 * OFFSET || 1;
    const p = this.slider.vertical
      ? Math.max(0, Math.min(1, (run - (pos - OFFSET)) / run))
      : Math.max(0, Math.min(1, (pos - OFFSET) / run));

    const { minValue, maxValue } = this.slider;
    return this.stepToNearestAllowedValue(p * (maxValue - minValue) + minValue);
  }

  /** The nearest value a step lands on, kept inside the slider's bounds. */
  stepToNearestAllowedValue(value) {
    const step = this.slider.step || 1;
    return Math.min(
      this.slider.maxValue,
      Math.max(this.slider.minValue, Math.round(value / step) * step),
    );
  }

  /**
   * The value the pointer is over, or `null` when the slider has no box to
   * measure against yet.
   *
   * @param {PointerEvent} event Where the pointer is.
   * @returns {number|null}
   */
  valueAt(event) {
    const rect = this.slider.node?.getBoundingClientRect?.();
    if (!rect) return null;

    const offsetX =
      Math.min(rect.width, event.clientX - rect.left) - this.grabOffset.x;
    const offsetY =
      Math.min(rect.height, event.clientY - rect.top) - this.grabOffset.y;

    return this.valueOfPosition(this.slider.vertical ? offsetY : offsetX);
  }

  /**
   * Take the value from where the pointer is.
   *
   * @param {PointerEvent} event Where the pointer is.
   * @param {boolean} fireEvents Whether the move is reported.
   */
  calcValue(event, fireEvents) {
    const value = this.valueAt(event);
    if (value === null) return;
    this.setValue(value, fireEvents);
  }

  /**
   * Take the knob to where the pointer is, without the slider becoming worth
   * it — a drag on a slider that reports only where it comes to rest.
   *
   * @param {PointerEvent} event Where the pointer is.
   */
  dragToward(event) {
    const value = this.valueAt(event);
    if (value === null) return;
    this.dragTo(value);
  }

  /**
   * Remember where on the knob the pointer took hold, so dragging moves it by
   * the same amount rather than snapping its middle under the pointer.
   */
  grab(event) {
    const rect = this.element?.getBoundingClientRect?.();
    if (!rect) return;
    this.grabOffset.x = event.clientX - rect.width / 2 - rect.left;
    this.grabOffset.y = event.clientY - rect.height / 2 - rect.top;
  }

  /** Dropped: the next press starts from the middle again. */
  release() {
    this.grabOffset.x = 0;
    this.grabOffset.y = 0;
  }
}
