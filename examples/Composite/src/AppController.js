/**
 * The controller behind `main.mib`.
 *
 * The page holds the state its composed views are given. Assigning to one of
 * these properties updates the tag's attribute, which reaches the view it was
 * given to — a composed view takes a changed attribute the same way it took the
 * first one.
 */
import { setTheme, theme } from "mosaic/frameworks/ui";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "Composite";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "press something";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;
  }

  // --- saying something to a composed view -----------------------------------

  /**
   * `this.queueCard` is StatCard.mib's own scope, handed over by the outlet on
   * its tag. Nothing was written for that file — no class, no controller — and
   * the page can still read what it holds and assign to it. A `{value}` in the
   * markup watches the property it reads, so the card redraws.
   */
  addToQueue() {
    const next = Number(this.queueCard.value) + 1;
    this.queueCard.value = String(next);
    this.queueCard.note = next === 1 ? "1 waiting" : `${next} waiting`;
    this.note = `queue is ${next}, set through the card's outlet`;
  }

  emptyQueue() {
    this.queueCard.value = "0";
    this.queueCard.note = "nothing waiting";
    this.note = "queue emptied";
  }

  /**
   * `this.reykjavik` is Reading.mib's own controller, handed over by the outlet
   * on its tag. `celsius` is the attribute the markup gave it, and assigning it
   * again is that same thing happening a second time — a prop is ordinary
   * state, so the view redraws.
   */
  warmer() {
    this.reykjavik.celsius = this.reykjavik.celsius + 1;
    this.note = `Reykjavík is now ${this.reykjavik.celsius.toFixed(1)} °C`;
  }

  resetReading() {
    this.reykjavik.celsius = 4.5;
    this.note = "put back to what the markup gave it";
  }

  // --- the surfaces ----------------------------------------------------------

  /**
   * Show the dialog. `this.summary` is SummaryDialog's own controller — an
   * outlet on a view that has one hands that over rather than the element it
   * drew — so this says what the page has to say to it and nothing about what
   * is inside it.
   */
  showSummary() {
    this.summary.onWarmer = (celsius) => {
      this.note = `the dialog's own Reading is now ${celsius.toFixed(1)} °C`;
    };
    this.summary.show();
    this.note = "the dialog's content is composed of the same views";
  }

  /**
   * And the popover, against the button that asked for it.
   *
   * @param {object} button The Button that was pressed.
   */
  showDetail(button) {
    this.detail.show(button);
    this.note = "the popover's content is composed of the same views";
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
