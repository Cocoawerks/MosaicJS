// Slider, ported from GWT Mosaic (client/components/Slider.java): one knob on a
// track, worth a number between a minimum and a maximum.
//
//   <Slider minValue="0" maxValue="100" value="40" step="5"
//           outlet="volume" action="volumeChanged"/>
//
// The action carries the new value. `continuous` decides how often: on by
// default, so a drag reports every step of the way; off, and it reports once,
// where the knob comes to rest.
import AbstractSlider from "./AbstractSlider.js";
import SliderHandle from "./SliderHandle.js";

export default class Slider extends AbstractSlider {
    /** One knob, which is the slider's whole value. */
    createHandles() {
        this.handles = [new SliderHandle(this)];
        this.handle = this.handles[0];
    }

    readInitialValues() {
        this.handle.value = this.constrain(Number(this.get("value", this.minValue)));
    }

    /** What the knob is worth, held inside the bounds. */
    get value() {
        return this.handle.value;
    }

    set value(value) {
        this.setValue(value, false);
    }

    /**
     * Move the knob, and say whether that counts as the user moving it.
     *
     * @param {number} value Where to put it.
     * @param {boolean} [fireEvents] Whether to report the move.
     */
    setValue(value, fireEvents = false) {
        this.handle.setValue(this.constrain(Number(value)), fireEvents);
    }

    /** Hold a value between the slider's ends. */
    constrain(value) {
        return Math.max(this.minValue, Math.min(this.maxValue, value));
    }

    /** After a bound moved, the value may no longer be inside it. */
    updateValue() {
        this.handle.setValue(this.constrain(this.handle.value));
        this.updateHandles();
        this.updateAria();
    }

    drawHandles() {
        return this.drawHandle(this.handle, this.get("name", null) ?? "Value");
    }
}
