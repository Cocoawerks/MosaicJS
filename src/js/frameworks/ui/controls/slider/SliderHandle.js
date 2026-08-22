// SliderHandle, ported from GWT Mosaic (client/components/SliderHandle.java):
// one knob on a slider's track — the value it stands for, and the arithmetic
// that turns that value into a position and a position back into a value.
//
// In Java a handle is a Component of its own, with the element and the event
// handlers to go with it. Here the element is drawn by the slider, because a
// stylesheet is scoped to the module that imports it and `.v-Slider .handle` is
// the slider's rule. What is left is this: the state and the sums. The slider
// owns the events and calls in.

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

    this.value = Math.max(
      this.slider.minValueForHandle(this),
      Math.min(this.slider.maxValueForHandle(this), value),
    );

    this.slider.handleMoved(this, fireEvents);
    return true;
  }

  // --- position ------------------------------------------------------------

  /** Where along the track this value sits, in pixels from the near end. */
  calcPosition() {
    const { minValue, maxValue } = this.slider;
    const span = maxValue - minValue || 1;
    const p = 1 - (maxValue - this.value) / span;

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
   * Take the value from where the pointer is.
   *
   * @param {PointerEvent} event Where the pointer is.
   * @param {boolean} fireEvents Whether the move is reported.
   */
  calcValue(event, fireEvents) {
    const rect = this.slider.node?.getBoundingClientRect?.();
    if (!rect) return;

    const offsetX =
      Math.min(rect.width, event.clientX - rect.left) - this.grabOffset.x;
    const offsetY =
      Math.min(rect.height, event.clientY - rect.top) - this.grabOffset.y;

    this.setValue(
      this.valueOfPosition(this.slider.vertical ? offsetY : offsetX),
      fireEvents,
    );
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
