// RangeSlider, ported from GWT Mosaic (client/components/RangeSlider.java): two
// knobs on one track, worth the span between them.
//
//   <RangeSlider minValue="0" maxValue="100" start="20" end="80"
//                outlet="priceRange" action="priceChanged"/>
//
// The two cannot cross: each is the other's bound, which is what
// `minValueForHandle` and `maxValueForHandle` are for. A press on the track
// takes whichever knob is nearer, so the span can be widened from either end.
import AbstractSlider from "./AbstractSlider.js";
import SliderHandle from "./SliderHandle.js";

export default class RangeSlider extends AbstractSlider {
  createHandles() {
    this.handles = [new SliderHandle(this), new SliderHandle(this)];
    [this.startHandle, this.endHandle] = this.handles;
    this.handle = this.startHandle;
  }

  /**
   * Read straight, not through `setValue`: the knobs bound each other, and
   * neither is in place yet to be a bound.
   */
  readInitialValues() {
    this.startHandle.value = Number(this.get("start", this.minValue));
    this.endHandle.value = Number(this.get("end", this.maxValue));
  }

  /** The span the two knobs hold, near end first. */
  get value() {
    return { start: this.startHandle.value, end: this.endHandle.value };
  }

  set value(value) {
    this.setValue(value, false);
  }

  get start() {
    return this.startHandle.value;
  }

  set start(value) {
    this.startHandle.setValue(Number(value), false);
  }

  get end() {
    return this.endHandle.value;
  }

  set end(value) {
    this.endHandle.setValue(Number(value), false);
  }

  /**
   * Move both ends at once. A span that reads backwards is refused rather
   * than quietly turned around.
   *
   * @param {{start: number, end: number}} range Where the two ends go.
   * @param {boolean} [fireEvents] Whether to report the move.
   */
  setValue(range, fireEvents = false) {
    if (!range || range.end < range.start) return;
    // The far knob first: moving the near one up against the old far knob
    // would be stopped by it before it had moved out of the way.
    this.endHandle.setValue(
      Math.min(this.maxValue, Number(range.end)),
      fireEvents,
    );
    this.startHandle.setValue(
      Math.max(this.minValue, Number(range.start)),
      fireEvents,
    );
  }

  // --- what each knob may take ---------------------------------------------

  minValueForHandle(handle) {
    return handle === this.endHandle ? this.startHandle.value : this.minValue;
  }

  maxValueForHandle(handle) {
    return handle === this.startHandle ? this.endHandle.value : this.maxValue;
  }

  updateValue() {
    this.setValue(this.value);
    this.updateHandles();
    this.updateAria();
  }

  /** The filled part runs between the knobs rather than up to one. */
  updateRangeLayer() {
    if (!this.rangeLayer) return;

    const from = this.startHandle.calcPosition();
    const length = this.endHandle.calcPosition() - from + 12;

    if (this.vertical) {
      this.rangeLayer.style.top = `${from}px`;
      this.rangeLayer.style.height = `${length}px`;
    } else {
      this.rangeLayer.style.left = `${from}px`;
      this.rangeLayer.style.width = `${length}px`;
    }
  }

  /**
   * Which knob a press takes: the nearer of the two, so the track can be
   * pressed anywhere and the span grows the way the user meant.
   */
  handleFor(event) {
    const rect = this.node?.getBoundingClientRect?.();
    if (!rect) return this.startHandle;

    const at = this.vertical
      ? event.clientY - rect.top
      : event.clientX - rect.left;
    const from = this.startHandle.calcPosition();
    const to = this.endHandle.calcPosition();

    if (from === to) return at > to ? this.endHandle : this.startHandle;
    if (at > to) return this.endHandle;
    if (at < from) return this.startHandle;
    return Math.abs(at - to) < Math.abs(at - from)
      ? this.endHandle
      : this.startHandle;
  }

  /** The knob being worked comes to the front, so it can pass the other. */
  setActive(handle, active) {
    super.setActive(handle, active);
    if (!active) return;
    for (const other of this.handles) {
      if (other.element)
        other.element.style.zIndex = other === handle ? "1" : "0";
    }
  }

  drawHandles() {
    return [
      this.drawHandle(this.startHandle, "Range start"),
      this.drawHandle(this.endHandle, "Range end"),
    ];
  }
}
