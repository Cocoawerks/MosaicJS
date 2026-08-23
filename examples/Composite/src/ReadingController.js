/**
 * The view's own controller, paired with Reading.ib.xml by name.
 *
 * What the tag said arrives here as properties — `place` and `celsius` are the
 * attributes — assigned before the view draws, so the first drawing already
 * reads them. That is the whole of how a composed view is given anything.
 *
 * They land before the markup has drawn, which means an outlet inside it is not
 * set yet: `unitButton` is only there once the view has been drawn.
 */
export default class ReadingController {
  constructor() {
    /** Whether it is showing Fahrenheit rather than Celsius. */
    this.fahrenheit = false;

    /** What the view reads. Bound in the markup, so assigning it redraws. */
    this.shown = "";

    /**
     * The button's label and face. Bound as props on the Button rather than
     * written to it through an outlet: a bound prop is worked out again when
     * the view redraws, so saying what it should be is all this has to do.
     */
    this.unitLabel = "°F";
    this.tone = "default";

    /** The reading itself, in Celsius. */
    this.degrees = 0;
  }

  /**
   * The attribute, taken through an accessor so the reading can be worked out
   * the moment it arrives: a prop is assigned like any other property, so a
   * setter is how a view does something with one as it lands.
   */
  get celsius() {
    return this.degrees;
  }

  set celsius(value) {
    this.degrees = Number(value) || 0;
    this.update();
  }

  /**
   * What the view shows. A plain property rather than a getter, because a
   * binding watches the property it reads and there is nothing to watch on a
   * getter — assigning this is what says the reading changed. A getter would
   * come right too, since every binding is re-read whenever anything else here
   * is assigned, but it would be right by way of its neighbours rather than by
   * saying so.
   */
  update() {
    this.shown = this.fahrenheit
      ? `${(this.celsius * 1.8 + 32).toFixed(1)} °F`
      : `${this.celsius.toFixed(1)} °C`;
  }

  /** Swap the unit, and say so. */
  toggleUnit() {
    this.fahrenheit = !this.fahrenheit;
    this.update();
    this.unitLabel = this.fahrenheit ? "°C" : "°F";
    this.tone = this.fahrenheit ? "primary" : "default";
    this.onToggle?.(this.fahrenheit);
  }
}
