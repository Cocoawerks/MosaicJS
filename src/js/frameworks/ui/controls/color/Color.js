// Color: a colour as four numbers, and the conversions a chooser needs to move
// between them.
//
// A value rather than a component: nothing here draws. Red, green and blue run
// 0–255; alpha runs 0–100, which is what the opacity slider shows.

/** A number held between two others. */
function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** Two hex digits, upper case, for a byte. */
function pad(value) {
  return clamp(Math.round(value), 0, 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
}

export default class Color {
  /**
   * @param {number} red 0–255.
   * @param {number} green 0–255.
   * @param {number} blue 0–255.
   * @param {number} alpha 0–100, opaque by default.
   */
  constructor(red = 0, green = 0, blue = 0, alpha = 100) {
    this.red = clamp(Math.round(red), 0, 255);
    this.green = clamp(Math.round(green), 0, 255);
    this.blue = clamp(Math.round(blue), 0, 255);
    this.alpha = clamp(Math.round(alpha), 0, 100);
  }

  // --- the ones with names -------------------------------------------------

  static white() {
    return new Color(255, 255, 255);
  }

  static black() {
    return new Color(0, 0, 0);
  }

  static red() {
    return new Color(255, 0, 0);
  }

  static green() {
    return new Color(0, 255, 0);
  }

  static blue() {
    return new Color(0, 0, 255);
  }

  // --- reading one -----------------------------------------------------------

  /**
   * The colour a hex string names: `#rgb`, `#rrggbb` or `#rrggbbaa`, with or
   * without the hash. Anything else is null, so a half-typed field says so
   * rather than guessing.
   *
   * @param {string} hex What was written.
   * @param {number} alpha What to use when the string says nothing about it.
   * @returns {Color|null} The colour, or null when the text is not one.
   */
  static fromHex(hex, alpha = 100) {
    const text = String(hex ?? "")
      .trim()
      .replace(/^#/, "");
    if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return null;

    // The short form is each digit doubled: `#0af` is `#00aaff`.
    const full =
      text.length === 3
        ? text
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : text;
    const value = Number.parseInt(full.slice(0, 6), 16);
    const opacity =
      full.length === 8
        ? Math.round((Number.parseInt(full.slice(6, 8), 16) / 255) * 100)
        : alpha;

    return new Color(
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
      opacity,
    );
  }

  /** The colour a 24-bit number names, `0x3584E4`, with the alpha given. */
  static fromRGB(rgb, alpha = 100) {
    return new Color((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, alpha);
  }

  /**
   * The colour hue, saturation and brightness name — each 0–1, as the chooser
   * works in — with the alpha given.
   */
  static fromHSB(hue, saturation, brightness, alpha = 100) {
    const sector = Math.floor(hue * 6);
    const offset = hue * 6 - sector;
    const p = brightness * (1 - saturation);
    const q = brightness * (1 - offset * saturation);
    const t = brightness * (1 - (1 - offset) * saturation);

    let red;
    let green;
    let blue;
    switch (((sector % 6) + 6) % 6) {
      case 0:
        [red, green, blue] = [brightness, t, p];
        break;
      case 1:
        [red, green, blue] = [q, brightness, p];
        break;
      case 2:
        [red, green, blue] = [p, brightness, t];
        break;
      case 3:
        [red, green, blue] = [p, q, brightness];
        break;
      case 4:
        [red, green, blue] = [t, p, brightness];
        break;
      default:
        [red, green, blue] = [brightness, p, q];
    }
    return new Color(red * 255, green * 255, blue * 255, alpha);
  }

  // --- what it says about itself ---------------------------------------------

  /**
   * Hue, saturation and brightness, each 0–1.
   *
   * A grey has no hue to report — every one of them answers 0, which is red —
   * so a caller working a hue control keeps its own and only takes this one
   * when the saturation says there is one.
   *
   * @returns {{hue: number, saturation: number, brightness: number}}
   */
  toHSB() {
    const red = this.red / 255;
    const green = this.green / 255;
    const blue = this.blue / 255;
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const spread = high - low;

    let hue = 0;
    if (spread !== 0) {
      if (high === red) hue = ((green - blue) / spread) % 6;
      else if (high === green) hue = (blue - red) / spread + 2;
      else hue = (red - green) / spread + 4;
      hue /= 6;
      if (hue < 0) hue += 1;
    }

    return {
      hue,
      saturation: high === 0 ? 0 : spread / high,
      brightness: high,
    };
  }

  /** The same colour at another opacity. */
  withAlpha(alpha) {
    return new Color(this.red, this.green, this.blue, alpha);
  }

  /** `#RRGGBB`, or `#RRGGBBAA` when asked for the opacity as well. */
  toHexString(withAlpha = false) {
    const rgb = `#${pad(this.red)}${pad(this.green)}${pad(this.blue)}`;
    return withAlpha ? rgb + pad((this.alpha / 100) * 255) : rgb;
  }

  /** What CSS should be given: `rgba(…)`, so the opacity is carried. */
  toString() {
    return `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha / 100})`;
  }

  equals(other) {
    return (
      other instanceof Color &&
      other.red === this.red &&
      other.green === this.green &&
      other.blue === this.blue &&
      other.alpha === this.alpha
    );
  }
}
