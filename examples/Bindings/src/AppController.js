/**
 * The controller behind `main.ib.xml`.
 *
 * Most of this page is joined up in the markup, so most of what would
 * ordinarily be here is not: there is no handler that copies a control's value
 * into a property, and no method that pushes a number back out to a control.
 * What is left is the state those joins run through, and the two joins markup
 * cannot express — a value that changes on the way across.
 */
import { bind, bindTwoWay, canPush } from "mosaic";
import { setTheme, theme } from "mosaic/frameworks/ui";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "Bindings";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "drag something";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;

    /**
     * @type {string} Filled by `<Bind source="nameField.value" target="name"/>`.
     * Nothing in this file assigns it.
     */
    this.name = "";

    /** @type {number} What the brightness buttons set, and the bar follows. */
    this.brightness = 60;

    /** @type {boolean} Joined both ways to the checkbox. */
    this.ready = false;

    /** @type {number} What the composed panel's knob is worth, seen from here. */
    this.mixerLevel = 35;

    /** @type {string} The temperature in words — written by a transform below. */
    this.spelt = "";

    /** @type {string} What the code in `attached()` had to say for itself. */
    this.codeNote = "";

    /**
     * @type {string} A bound prop, spelled out for the page to show. It is
     * held here rather than written in the markup because writing it there is
     * how a page says it for real — the markup would bind it rather than
     * print it, which is the distinction that paragraph is drawing.
     */
    this.propExample = 'enabled="{ready}"';
  }

  /**
   * A getter reads whatever it reads at the moment it is called, and every
   * binding on this page is re-read when anything here is assigned — so this
   * follows `name` without being told about it. What it cannot do is be the
   * *source* of a join: there is nothing to assign, so nothing to observe.
   */
  get greeting() {
    return this.name ? `hello, ${this.name}` : "nobody yet";
  }


  awakeFromMib() {
    // One way, with the value changed on the way across. This is the whole of
    // what `<Bind/>` leaves to code — a tag carrying an expression would be a
    // second language growing inside the markup.
    bind(this.celsiusSlider, "value", this, "spelt", (c) =>
      `${c} °C is ${(c * 1.8 + 32).toFixed(0)} °F — ${this.describe(c)}`,
    );

    // Both ways, and not the same value at each end: each direction says what
    // the number becomes going that way. The two have to undo each other, or
    // the pair will not settle.
    bindTwoWay(this.celsiusSlider, "value", this.fahrenheitSpin, "value", {
      to: (c) => Math.round(c * 1.8 + 32),
      from: (f) => Math.round((f - 32) / 1.8),
    });

    // A property with no setter cannot push: nothing assigns it, so nothing
    // can be told it changed. Binding from one is not refused — the value is
    // copied across once — and this is how to find that out before being
    // surprised by it.
    this.codeNote =
      `canPush(slider, "value") → ${canPush(this.celsiusSlider, "value")} · ` +
      `canPush(this, "greeting") → ${canPush(this, "greeting")} ` +
      `(a getter has nothing to observe)`;
  }

  /** Words for a temperature, for the transform above. */
  describe(celsius) {
    if (celsius < 0) return "freezing";
    if (celsius < 12) return "cold";
    if (celsius < 24) return "mild";
    return "warm";
  }

  // --- what the buttons do, which is assign a property -----------------------

  /**
   * The bar is not touched here, and neither is the number beside it. Both are
   * joined to `brightness` in the markup, so setting it is the whole of what a
   * button has to do.
   */
  dimmer() {
    this.brightness = Math.max(0, this.brightness - 10);
    this.note = `brightness = ${this.brightness}`;
  }

  brighter() {
    this.brightness = Math.min(100, this.brightness + 10);
    this.note = `brightness = ${this.brightness}`;
  }

  /**
   * And the checkbox is not touched either: the join is two-way, so assigning
   * the property this end ticks the box at the other.
   */
  toggleReady() {
    this.ready = !this.ready;
    this.note = `ready = ${this.ready}, set from code — the box followed`;
  }

  send() {
    this.note = "sent";
  }

  // --- the theme -------------------------------------------------------------

  /**
   * @param {object} combo The ComboBox that fired.
   * @param {string} value The theme chosen.
   */
  themeChanged(combo, value) {
    this.theme = setTheme(value);
    this.note = `theme: ${value}`;
  }
}
