/**
 * A formatter — an object a page places, and never a thing on the page.
 *
 * It has no `draw()`, so a `<CurrencyFormatter/>` tag does not put anything in
 * the document: the runtime constructs it, hands it to the tag's outlet, and
 * leaves a comment where the tag was written. What the tag says arrives twice
 * over — the constructor is given the props, and each is assigned as a
 * property afterwards — so a formatter can take its settings whichever way
 * suits it. This one takes them as properties, since the page changes them
 * while it is running.
 *
 *   <CurrencyFormatter outlet="money" currency="GBP" locale="en-GB"/>
 *
 * Written as a class deliberately: a class is how the runtime tells an object
 * tag from a hand-written function component, which is the one thing it cannot
 * work out for itself.
 */
export default class CurrencyFormatter {
  /**
   * @param {object} props what the tag said. Kept only to show that a
   *   constructor is given them; everything below reads the properties, which
   *   is what the page assigns as it runs.
   */
  constructor(props) {
    /** @type {object} What this was placed with. */
    this.placedWith = { ...props };

    /** @type {string} */
    this.locale = "en-GB";
    /** @type {string} An ISO 4217 code. */
    this.currency = "GBP";

    /**
     * The `Intl.NumberFormat` in hand, and the settings it was built for.
     * Rebuilt when they change rather than on every call: formatting a number
     * is what this is for, and building a formatter costs a great deal more
     * than using one.
     */
    this.built = null;
    this.builtFor = "";
  }

  /** How many times a formatter had to be built — what the page reports. */
  static builds = 0;

  /** @returns {Intl.NumberFormat} */
  get formatter() {
    const key = `${this.locale}/${this.currency}`;
    if (this.built && this.builtFor === key) return this.built;
    this.built = new Intl.NumberFormat(this.locale, {
      style: "currency",
      currency: this.currency,
    });
    this.builtFor = key;
    CurrencyFormatter.builds += 1;
    return this.built;
  }

  /**
   * @param {number} amount
   * @returns {string} the amount in this formatter's currency and locale.
   */
  format(amount) {
    return this.formatter.format(Number(amount) || 0);
  }
}
