/**
 * The controller behind SensorPanel.ib.xml: the posting end.
 *
 * The only thing it imports is the model. It calls one method on a sensor and
 * is finished — what the reading means to the rest of the page is not its
 * business, and adding a fourth panel that reacts to readings would not change
 * a line of this file.
 */
import { sensors } from "./sensors.js";

export default class SensorPanelController {
  constructor() {
    /** @type {string} Which sensor this panel moves — the `which` attribute. */
    this.which = "kitchen";

    /** @type {string} What the panel says its reading is. */
    this.reading = "18.0 °C";
  }

  /** The sensor's own name, for the heading. */
  get place() {
    return this.sensor.place;
  }

  /** The model object this panel is a handle on. */
  get sensor() {
    return sensors[this.which];
  }

  /**
   * The slider moved. Tell the sensor, and let it announce it.
   *
   * This panel shows the reading itself rather than observing its own sensor:
   * it is the one that caused the change, so it already knows. Observing what
   * you posted is a loop waiting to happen.
   *
   * @param {object} slider The Slider that fired.
   * @param {number} value  Where the knob is now.
   */
  moved(slider, value) {
    this.reading = `${Number(value).toFixed(1)} °C`;
    this.sensor.read(value);
  }
}
