// What the page is made of. Markup names a component; this is what puts it
// within reach — and what keeps the rest of the framework out of the bundle.
import { setTheme } from "mosaic/frameworks/ui";

/**
 * The controller behind `main.mib`: the calculator itself.
 *
 * The page is Buttons and two bound lines. What connects them is what connects
 * any Mosaic page: `{bindings}` are the text it shows — assigning to one of
 * those properties updates the DOM, because binding to a property is what makes
 * it observed — and `action` names the method a control calls when it is
 * worked.
 *
 * A control calls its action with itself, so there is one method per kind of
 * key rather than one per key: `digit(button)` asks the button that fired what
 * it reads. The keys state what they mean in the markup, and this file states
 * what the machine does with them.
 *
 * The arithmetic is the usual four-function kind: a number is entered, an
 * operator holds it aside, the next number is entered, and `=` — or the next
 * operator — settles what is owed.
 */
export default class AppController {
  constructor() {
    // Bound in the markup, so assigning to one of these updates its text.

    /** @type {string} The number being entered, as it reads on screen. */
    this.display = "0";
    /** @type {string} The sum so far: "12 ×" while the second number is typed. */
    this.expression = "";
    /** @type {string} A line for the reader, when something needs saying. */
    this.hint = "Use the keys or the keyboard; = or Enter settles.";

    /**
     * The number held aside while the next one is entered, or null when
     * nothing is pending.
     *
     * @type {number|null}
     */
    this.held = null;

    /**
     * The operator waiting on a second number, or null.
     *
     * @type {string|null}
     */
    this.pending = null;

    /**
     * Whether the next digit starts a new number rather than extending the
     * one shown. True after an operator, an equals, or a clear — the moment
     * the number on screen stops being one the user is still typing.
     *
     * @type {boolean}
     */
    this.fresh = true;

    /**
     * Whether the last sum failed. A calculator showing an error is not
     * showing a number, so it takes no further keys until it is cleared.
     *
     * @type {boolean}
     */
    this.errored = false;
  }

  /**
   * Wear the dark theme, or the light one.
   *
   * It is a stylesheet swap and nothing else: nothing is redrawn, and the sum
   * in progress is untouched.
   *
   * @param {object} control The Switch that was flipped.
   * @param {boolean} on Whether it is now on.
   */
  darkChanged(control, on) {
    setTheme(on ? "aristo_dark" : "aristo");
  }

  // --- the keyboard ---------------------------------------------------------

  /**
   * The page itself, handed over by `outlet="page"`.
   *
   * Focused as it arrives, because a page nothing has focused hears no
   * keystrokes — but never taken back off a key the user has tabbed to, since
   * the outlet is assigned again on every redraw.
   *
   * @param {Element} element The page's root element.
   */
  set page(element) {
    this.pageElement = element;
    if (!element) return;

    // Not yet: an outlet is handed over while the tree is still being
    // built, and focusing an element that is not in the document does
    // nothing at all. A moment later it is there.
    queueMicrotask(() => {
      const doc = element.ownerDocument;
      if (!doc || !doc.contains(element)) return;
      // Never taken off a key the user tabbed to — the outlet is assigned
      // again on every redraw.
      if (element.contains(doc.activeElement)) return;
      element.focus?.();
    });
  }

  get page() {
    return this.pageElement;
  }

  /**
   * A key was typed. What the keyboard sends is turned into the key the page
   * shows, and then it is the same press either way — `1` from the keyboard
   * and the `1` on screen both arrive at {@link #digit}.
   *
   * @param {KeyboardEvent} event What was typed.
   */
  keyPressed(event) {
    // Leave the browser's own shortcuts alone.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (this.type(event.key)) {
      // Only once it is ours: "/" is quick-find in some browsers and
      // Backspace was once the back button.
      event.preventDefault();
    }
  }

  /**
   * Do what a key means, if it means anything here.
   *
   * @param {string} key The key's name, as a KeyboardEvent gives it.
   * @returns {boolean} Whether it was one of ours.
   */
  type(key) {
    if (/^[0-9.]$/.test(key)) {
      this.digit({ text: key });
      return true;
    }

    // What the keyboard has, against what the keys read.
    const operators = { "+": "+", "-": "−", "*": "×", x: "×", "/": "÷" };
    if (key in operators) {
      this.operator({ text: operators[key] });
      return true;
    }

    switch (key) {
      case "Enter":
      case "=":
        this.equals();
        return true;
      case "Escape":
      case "c":
      case "C":
        this.clear();
        return true;
      case "%":
        this.percent();
        return true;
      case "Backspace":
        this.backspace();
        return true;
      default:
        return false;
    }
  }

  /**
   * Take back the last digit typed. There is no key for this on screen —
   * the keyboard has one, so it does what that key is for.
   */
  backspace() {
    if (this.errored || this.fresh) return;

    const shorter = this.display.slice(0, -1);
    // Nothing left, or nothing but a minus sign: back to zero.
    this.display = shorter === "" || shorter === "-" ? "0" : shorter;
    if (this.display === "0") this.fresh = true;
  }

  // --- what the keys do -----------------------------------------------------

  /**
   * A digit, or the decimal point. Which one it was is what the sender reads.
   *
   * @param {object} sender The Button that was pressed.
   */
  digit(sender) {
    if (this.errored) return;

    const char = sender.text;

    if (char === ".") {
      // A point on a fresh entry starts "0.", so the number always has a
      // digit before it; a second point in one number is not a number.
      if (this.fresh) {
        this.display = "0.";
        this.fresh = false;
      } else if (!this.display.includes(".")) {
        this.display += ".";
      }
      return;
    }

    if (this.fresh) {
      this.display = char;
      this.fresh = false;
    } else {
      // A leading zero is not worth keeping: "0" then "5" is 5, not 05.
      this.display = this.display === "0" ? char : this.display + char;
    }
  }

  /**
   * An operator. Anything already pending is settled first, so pressing
   * `2 + 3 × 4` reads as `(2 + 3) × 4` — what a four-function calculator
   * does, rather than what algebra would.
   *
   * @param {object} key The Button that was pressed.
   */
  operator(key) {
    if (this.errored) return;

    if (this.pending !== null && !this.fresh) {
      if (!this.settle()) return;
    } else {
      this.held = this.value;
    }

    this.pending = key.text;
    this.fresh = true;
    this.expression = `${this.format(this.held)} ${this.pending}`;
    this.hint = "Now the second number.";
  }

  /** Settle what is owed and show the answer. */
  equals() {
    if (this.errored || this.pending === null) return;

    const sum = `${this.expression} ${this.display} =`;
    if (!this.settle()) return;

    this.pending = null;
    this.held = null;
    this.fresh = true;
    this.expression = sum;
    this.hint = "Press a key to start again.";
  }

  /** Everything back to nothing. */
  clear() {
    this.display = "0";
    this.expression = "";
    this.held = null;
    this.pending = null;
    this.fresh = true;
    this.errored = false;
    this.hint = "Use the keys or the keyboard; = or Enter settles.";
  }

  /** Turn the number on screen negative, or positive again. */
  negate() {
    if (this.errored || this.display === "0") return;
    this.display = this.display.startsWith("-")
      ? this.display.slice(1)
      : `-${this.display}`;
  }

  /**
   * Per cent. On its own that is a hundredth; against a pending sum it is a
   * hundredth *of the number held aside*, so `200 + 10 %` is 200 + 20.
   */
  percent() {
    if (this.errored) return;

    const share =
      this.pending !== null && this.held !== null
        ? (this.held * this.value) / 100
        : this.value / 100;

    this.display = this.format(share);
    this.fresh = true;
  }

  // --- the arithmetic itself ------------------------------------------------

  /** The number on screen. */
  get value() {
    const n = Number.parseFloat(this.display);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Apply the pending operator to the number held aside and the one on
   * screen, and show the result.
   *
   * @returns {boolean} Whether it worked; false means the calculator is now
   *     showing an error and nothing further should be done to it.
   */
  settle() {
    const left = this.held ?? 0;
    const right = this.value;
    let result;

    switch (this.pending) {
      case "+":
        result = left + right;
        break;
      case "−":
        result = left - right;
        break;
      case "×":
        result = left * right;
        break;
      case "÷":
        if (right === 0) {
          this.fail("Nothing divides by zero.");
          return false;
        }
        result = left / right;
        break;
      default:
        result = right;
    }

    if (!Number.isFinite(result)) {
      this.fail("That is more than this can hold.");
      return false;
    }

    this.display = this.format(result);
    this.held = result;
    this.fresh = true;
    return true;
  }

  /**
   * A number as it should read.
   *
   * Rounded before it is shown: binary floating point makes 0.1 + 0.2 into
   * 0.30000000000000004, which is true of the machine and useless to the
   * reader. Twelve significant figures is well inside what a double holds
   * exactly, so nothing is lost that was ever really there.
   *
   * @param {number} n The number.
   * @returns {string} What the display should read.
   */
  format(n) {
    if (!Number.isFinite(n)) return "∞";

    const rounded = Number.parseFloat(n.toPrecision(12));
    // Very large and very small numbers are worth more as exponents than as
    // a screenful of zeroes.
    if (
      rounded !== 0 &&
      (Math.abs(rounded) >= 1e12 || Math.abs(rounded) < 1e-9)
    ) {
      return rounded.toExponential(6).replace("e", " e");
    }
    return String(rounded);
  }

  /**
   * Show a failure and refuse further work until the calculator is cleared.
   *
   * @param {string} why What went wrong, in words.
   */
  fail(why) {
    this.display = "Error";
    this.expression = "";
    this.hint = `${why} Press C.`;
    this.held = null;
    this.pending = null;
    this.fresh = true;
    this.errored = true;
  }
}
