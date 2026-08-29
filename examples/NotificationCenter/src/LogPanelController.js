/**
 * The controller behind LogPanel.ib.xml: observing with `observe()`, and undoing
 * it with what that returned.
 *
 * The other spelling — `addObserver(this, "method", name)` — is in
 * ReadoutController.js. The difference is only how a subscription is dropped:
 * this one holds the function it was handed, the way `bind` is undone, which
 * is what to reach for when a single subscription comes and goes on its own.
 */
import { notifications } from "mosaic";

import { READING_TAKEN, THRESHOLD_CROSSED } from "./sensors.js";

export default class LogPanelController {
  constructor() {
    /** @type {string} The log itself, newest line last. */
    this.lines = "";

    /** @type {string} What `once()` caught, and never heard about again. */
    this.firstSeen = "still waiting";

    /**
     * @type {Array<() => void>} What `observe()` handed back. Holding them is
     * the whole of unsubscribing later.
     */
    this.undo = [];
  }

  /** On the page: subscribe, and arm the one-shot. */
  awakeFromMib() {
    this.subscribe();

    // `once` hears the next notification and lets go of itself. Nothing has to
    // be undone afterwards, and it cannot fire twice however many readings the
    // sliders produce.
    notifications.once(READING_TAKEN, (note) => {
      this.firstSeen = `${note.info.place} at ${note.info.celsius.toFixed(1)} °C`;
    });
  }

  /** Off the page: everything this panel subscribed to goes. */
  detached() {
    this.unsubscribe();
  }

  /**
   * Two subscriptions, neither narrowed to a sender: this panel wants every
   * reading from every sensor, which is what leaving `sender` out means.
   *
   * A handler is a closure rather than a named method, so it can be written
   * where the subscription is — that is the reason to prefer this spelling.
   */
  subscribe() {
    if (this.undo.length > 0) return;

    this.undo.push(
      notifications.observe(READING_TAKEN, (note) => {
        this.write(`${note.name}  ${note.info.place}  ${note.info.celsius.toFixed(1)} °C`);
      }),
    );

    this.undo.push(
      notifications.observe(THRESHOLD_CROSSED, (note) => {
        this.write(
          `${note.name}  ${note.info.place} is now ${note.info.warm ? "warm" : "cool"}`,
        );
      }),
    );
  }

  /** Call each undo, and forget them: calling one twice is harmless anyway. */
  unsubscribe() {
    for (const undo of this.undo) undo();
    this.undo = [];
  }

  /**
   * The checkbox. Unticked, this panel stops hearing — and the sensors are not
   * told, because there is nothing to tell: a post with no observers is not an
   * error and does nothing.
   *
   * @param {object} checkBox The CheckBox that fired.
   * @param {boolean} on      Ticked or not.
   */
  toggleSubscription(checkBox, on) {
    if (on) {
      this.subscribe();
      this.write("— subscribed —");
    } else {
      this.unsubscribe();
      this.write("— unsubscribed, the sensors carry on posting —");
    }
  }

  clear() {
    this.lines = "";
  }

  /**
   * Add a line. Assigning `lines` is what redraws the panel — a binding
   * watches the property it reads, so there is nothing else to do.
   *
   * @param {string} line
   */
  write(line) {
    const kept = this.lines ? this.lines.split("\n").slice(-60) : [];
    kept.push(line);
    this.lines = kept.join("\n");
  }
}
