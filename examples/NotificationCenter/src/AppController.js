/**
 * The controller behind `main.ib.xml`.
 *
 * It lays the page out and demonstrates the two calls that are about the
 * center rather than about any one subscription: asking what is listening,
 * and posting something itself.
 *
 * What it does not do is join anything to anything. There is no outlet in the
 * markup and nothing is wired up here — the panels find each other through the
 * notification's name, which is the whole point of the example.
 */
import { notifications } from "mosaic";
import { setTheme, theme } from "mosaic/frameworks/ui";

import { READING_TAKEN, kitchen } from "./sensors.js";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "NotificationCenter";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "move a slider";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;
  }

  // --- asking the center -----------------------------------------------------

  /**
   * What is being observed, and whether anyone would hear a reading.
   *
   * `hasObservers` is what a poster asks before doing expensive work: a
   * reading nobody is listening for is a reading not worth taking. The count
   * here changes as the log's checkbox goes on and off, without anything
   * having told this controller about it.
   */
  whoIsListening() {
    const names = notifications.observedNames();
    const heard = notifications.hasObservers(READING_TAKEN, kitchen);
    this.note =
      `observedNames() → [${names.join(", ")}] · ` +
      `hasObservers("${READING_TAKEN}", kitchen) → ${heard}`;
  }

  // --- posting from somewhere that is not a sensor ---------------------------

  /**
   * Post with no sender at all. Every unnarrowed observer hears it — the log
   * and the "Every sensor" readout — and the two narrowed to a sensor do not,
   * because what they asked for was that object's notifications.
   */
  postAnonymously() {
    const told = notifications.post(READING_TAKEN, null, {
      place: "Nowhere",
      celsius: 21,
    });
    this.note = `post(…, null, …) → told ${told} observer${told === 1 ? "" : "s"} — the narrowed readouts heard nothing`;
  }

  /**
   * The same notification posted as the kitchen sensor, which the readout
   * watching it does hear. Nothing about the sensor changed: a sender is who
   * the notification is about, and the center does not ask it anything.
   */
  postAsKitchen() {
    const told = notifications.post(READING_TAKEN, kitchen, {
      place: kitchen.place,
      celsius: kitchen.celsius,
    });
    this.note = `post(…, kitchen, …) → told ${told} observer${told === 1 ? "" : "s"}`;
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
