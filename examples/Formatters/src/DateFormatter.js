/**
 * The same idea for a date, and the same class placed twice with different
 * settings — which is the point of it being a tag rather than something a
 * controller builds. Two formatters, named where they are used:
 *
 *   <DateFormatter outlet="onTheDay" dateStyle="full"/>
 *   <DateFormatter outlet="atTheTime" timeStyle="medium"/>
 *
 * A tag's attributes are text, so `dateStyle="full"` arrives as the string
 * "full" — which is exactly what `Intl.DateTimeFormat` wants. The two words
 * markup cannot say as themselves are `true` and `false`, and the runtime
 * reads those back into booleans before they land.
 */
export default class DateFormatter {
  constructor() {
    /** @type {string} */
    this.locale = "en-GB";
    /** @type {string|undefined} `full`, `long`, `medium`, `short`. */
    this.dateStyle = undefined;
    /** @type {string|undefined} likewise, for the time. */
    this.timeStyle = undefined;
  }

  /**
   * @param {Date} when
   * @returns {string}
   */
  format(when) {
    if (!when) return "";
    const options = {};
    if (this.dateStyle) options.dateStyle = this.dateStyle;
    if (this.timeStyle) options.timeStyle = this.timeStyle;
    return new Intl.DateTimeFormat(this.locale, options).format(when);
  }
}
