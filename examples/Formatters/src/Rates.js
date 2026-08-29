/**
 * A module that exports an object rather than a class — the other thing an
 * object tag can name.
 *
 * A class is constructed once per tag, so two pages placing one get two. An
 * object is taken as it stands, so two pages placing this get the same rates,
 * and one page changing them changes them for the other. That is the whole
 * difference, and it is said by exporting one or the other.
 *
 *   <Rates outlet="rates"/>
 *
 * Nothing is copied and nothing is constructed. The tag is how the page says
 * "this is one of the things I am made of", in the place where it is used,
 * rather than an import at the top of a controller.
 */
const Rates = {
  /** Everything against the pound, which is what `base` names. */
  base: "GBP",

  /** @type {Record<string, number>} */
  table: {
    GBP: 1,
    USD: 1.27,
    EUR: 1.17,
    JPY: 193.4,
  },

  /**
   * @param {number} amount in the base currency
   * @param {string} currency to convert to
   * @returns {number}
   */
  convert(amount, currency) {
    const rate = this.table[currency] ?? 1;
    return (Number(amount) || 0) * rate;
  },

  /** @returns {string[]} the currencies there is a rate for. */
  get currencies() {
    return Object.keys(this.table);
  },
};

export default Rates;
