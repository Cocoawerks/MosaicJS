/**
 * The controller behind `main.ib.xml`.
 *
 * What is not here is the point of the example. There is no
 * `awakeFromMib()` building a formatter, no `new Intl.NumberFormat` anywhere,
 * no timer started and no timer cleared: the page places those objects itself,
 * and each looks after its own beginning and end.
 *
 * What is left is state and readings. The state is what the controls and the
 * clock assign into; the readings are getters that ask the objects the page
 * placed what to say. A getter reads whatever it reads at the moment it is
 * called, and every binding is re-read when anything observed here is
 * assigned — so a reading follows the objects without being told about them.
 */
import { setTheme, theme } from "mosaic/frameworks/ui";

import CurrencyFormatter from "./CurrencyFormatter.js";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "Formatters";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "drag the slider, or change the currency";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;

    /** @type {number} Filled by `<Bind source="amountSlider.value" .../>`. */
    this.amount = 1250;

    /** @type {string} Carried onto the formatter by a `<Bind/>` in the markup. */
    this.currency = "GBP";

    /** @type {string} Likewise. */
    this.locale = "en-GB";

    /**
     * @type {Date} Filled by `<Bind source="clock.now" target="now"/>`, and
     * shown raw beside the two formatted readings — which is what makes it a
     * property the page watches, and so what brings them up to date each tick.
     */
    this.now = new Date();

    /** @type {boolean} What the button toggles, and the readings below use. */
    this.rounding = false;
  }

  /**
   * Every outlet is assigned by now — that is what this hook is for — so the
   * objects the markup placed can be spoken to. One assignment is enough to
   * bring the page's readings up to date: they drew before the outlets existed
   * and said nothing, and assigning an observed property is what re-reads them.
   */
  awakeFromMib() {
    this.note = `placed: money, onTheDay, atTheTime, clock, rates — ${
      this.rates === undefined ? "none" : this.rates.currencies.join(", ")
    }`;
  }

  // --- the readings ----------------------------------------------------------
  //
  // Each guards against the objects not being there yet: the markup draws
  // before its outlets are assigned, so the first reading of every one of
  // these happens with nothing to ask.

  /** @returns {string} The amount, as the formatter the page placed says it. */
  get formatted() {
    return this.money ? this.money.format(this.shown) : "";
  }

  /** @returns {string} The same amount converted first, then formatted. */
  get converted() {
    if (!this.money || !this.rates) return "";
    const converted = this.rates.convert(this.amount, this.currency);
    return this.money.format(this.rounding ? Math.round(converted) : converted);
  }

  /** @returns {number} What the readings show, rounded or not. */
  get shown() {
    const converted = this.rates
      ? this.rates.convert(this.amount, this.currency)
      : this.amount;
    return this.rounding ? Math.round(converted) : converted;
  }

  /** @returns {string} Today, from the formatter told `dateStyle="full"`. */
  get today() {
    return this.onTheDay ? this.onTheDay.format(this.now) : "";
  }

  /** @returns {string} And the time, from the one told `timeStyle="medium"`. */
  get clockReading() {
    return this.atTheTime ? this.atTheTime.format(this.now) : "";
  }

  /** @returns {string} The base currency the shared rates are quoted against. */
  get ratesBase() {
    return this.rates?.base ?? "";
  }

  /** @returns {string} The rate in force, off the object the tag placed. */
  get rateLine() {
    if (!this.rates) return "";
    const rate = this.rates.table[this.currency] ?? 1;
    return `1 ${this.rates.base} = ${rate} ${this.currency}`;
  }

  /**
   * @returns {number} How many `Intl.NumberFormat`s have been built since the
   * page opened. It climbs when the currency or the locale changes and at no
   * other time — the formatter is not rebuilt by the page redrawing, because
   * the page redrawing does not build it again.
   */
  get builds() {
    return CurrencyFormatter.builds;
  }

  /** @returns {number} The clock's own count, read off the object. */
  get ticks() {
    return this.clock?.ticks ?? 0;
  }

  /** @returns {string} A bound prop, which is what makes this page redraw. */
  get roundLabel() {
    return this.rounding ? "Show the pennies" : "Round it off";
  }

  // --- what the controls do --------------------------------------------------

  /**
   * The formatter is not touched here. The combo assigns this property and the
   * `<Bind source="currency" target="money.currency"/>` in the markup carries
   * it across — which is the same tag doing the same thing it does between two
   * controls.
   *
   * @param {object} combo The ComboBox that fired.
   * @param {string} value The currency chosen.
   */
  currencyChanged(combo, value) {
    this.currency = value;
    this.note = `currency = ${value} — the Bind put it on the formatter`;
  }

  /**
   * @param {object} combo
   * @param {string} value The locale chosen.
   */
  localeChanged(combo, value) {
    this.locale = value;
    this.note = `locale = ${value}`;
  }

  toggleRounding() {
    this.rounding = !this.rounding;
    this.note = `rounding = ${this.rounding}`;
  }

  /**
   * @param {object} combo
   * @param {string} value The theme chosen.
   */
  themeChanged(combo, value) {
    this.theme = setTheme(value);
    this.note = `theme: ${value}`;
  }
}
