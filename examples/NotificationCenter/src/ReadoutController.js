/**
 * The controller behind Readout.ib.xml: the observing end, written the Cocoa way.
 *
 *   notifications.addObserver(this, "readingTaken", READING_TAKEN, sender);
 *   notifications.removeObserver(this);
 *
 * Subscribing by observer rather than by token is what makes the teardown one
 * line: `removeObserver(this)` drops every subscription this object made,
 * however many that is, without holding a token for each.
 *
 * Where it happens matters as much as that it happens. `attached()` is the
 * moment this view is on the page and `detached()` the moment it leaves, and
 * a subscription that outlives its view is both a leak — the center holds the
 * observer, so nothing here can be collected — and a bug, since a view off the
 * page goes on reacting to news it can no longer show.
 */
import { notifications } from "mosaic";

import { READING_TAKEN, THRESHOLD_CROSSED, sensors } from "./sensors.js";

export default class ReadoutController {
  constructor() {
    /**
     * @type {string} Which sensor to hear — the `watch` attribute. Empty means
     * every one of them.
     */
    this.watch = "";

    this.title = "";
    this.value = "—";
    this.heard = "nothing yet";

    /** How many notifications have reached this readout. */
    this.count = 0;
  }

  /**
   * On the page: subscribe.
   *
   * The sender is `undefined` for a readout that watches everything, which is
   * what `addObserver` takes to mean "whoever posts it". Narrowing needs the
   * object itself, so this imports the sensor from the model — the one thing
   * both ends of a notification are allowed to share.
   */
  awakeFromMib() {
    const sender = sensors[this.watch] ?? null;
    this.title = sender ? `${sender.place} only` : "Every sensor";

    notifications.addObserver(this, "readingTaken", READING_TAKEN, sender);
    // A second subscription, to a different notification, from the same
    // observer. Both come off together below.
    notifications.addObserver(this, "crossed", THRESHOLD_CROSSED, sender);
  }

  /** Off the page: let go of both subscriptions at once. */
  detached() {
    notifications.removeObserver(this);
  }

  /**
   * A reading was taken. The method is named by `addObserver` and called on
   * this object, so `this` is the controller and the notification is the only
   * argument.
   *
   * @param {object} note
   */
  readingTaken(note) {
    this.count++;
    this.value = `${note.info.celsius.toFixed(1)} °C`;
    this.heard = `${note.info.place} · ${this.count} notification${this.count === 1 ? "" : "s"}`;
  }

  /**
   * And the other notification, on the same object.
   *
   * @param {object} note
   */
  crossed(note) {
    this.heard = `${note.info.place} went ${note.info.warm ? "warm" : "cool"}`;
  }
}
