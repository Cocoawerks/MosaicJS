// Announcing that something happened, to whoever cares.
//
// A binding joins two things that know about each other: something has to hold
// both ends to write `bind(this.slider, "value", this, "volume")`. That is the
// right shape when one thing owns the other, and the wrong one across a
// distance — a title bar that has to grey out while a document is saving does
// not want a reference to the document, and the document has no business
// knowing a title bar exists.
//
// A notification center is the other shape. The poster names what happened;
// the observers name what they want to hear about; neither is given the other:
//
//   // wherever the work is done
//   notifications.post("DocumentSaving", this, { file });
//
//   // wherever something has to react — a different module, any number of them
//   this.saving = notifications.observe("DocumentSaving", (note) => {
//     this.busy = true;
//   });
//
// `observe` hands back the function that undoes it, the way `bind` does, and
// for the same reason: the center holds the observer, so one that outlives its
// subscription has to be let go of or it is kept alive by it. A component or
// controller with a `detached()` is where that call belongs.
//
// The Cocoa spelling — an observer object and the name of the method to call —
// is here too, and unsubscribes by observer rather than by token:
//
//   notifications.addObserver(this, "documentSaving", "DocumentSaving");
//   notifications.removeObserver(this);          // every subscription it made
//
// Delivery is synchronous and in the order observers subscribed: `post`
// returns once every observer has run. Nothing here touches the DOM — this is
// about application state, not about events, which travel up the tree on their
// own and are handled by `action=` and the `BROWSER_EVENTS` methods.

/**
 * What an observer is handed: what happened, what it happened to, and whatever
 * else the poster wanted to say about it.
 *
 * @typedef {object} Notification
 * @property {string} name    what happened
 * @property {*} sender       what it happened to, or null if it was not about
 *   anything in particular
 * @property {object} info    the poster's extra detail, `{}` if there was none
 */

/**
 * A place notifications are posted to and observed on.
 *
 * There is one of these already — `notifications`, the default center — and an
 * application that wants a channel of its own, isolated from everything else
 * posting, can make another.
 */
export class NotificationCenter {
  /**
   * Subscriptions by notification name.
   * @type {Map<string, Array<object>>}
   */
  #byName = new Map();

  /**
   * @public Listen for `name` until the returned function is called.
   *
   * `sender` narrows a subscription to notifications posted by one object,
   * which is what to reach for when many things post the same name and only
   * one of them is interesting — a list watching its own model rather than
   * every model in the application.
   *
   *   const undo = notifications.observe("ThemeChanged", (note) => {
   *     this.theme = note.info.name;
   *   });
   *
   * @param {string} name       what to hear about
   * @param {(note: Notification) => void} handler
   * @param {{sender?: *, once?: boolean}} [options]
   *   `sender` hears only that object's notifications; `once` unsubscribes
   *   after the first delivery.
   * @returns {() => void} unsubscribes. Calling it twice is harmless.
   */
  observe(name, handler, options = {}) {
    if (typeof name !== "string" || name === "") {
      throw new TypeError("observe() needs a notification name");
    }
    if (typeof handler !== "function") {
      throw new TypeError(`observe("${name}") needs a handler function`);
    }
    return this.#add({
      name,
      handler,
      observer: null,
      sender: options.sender ?? null,
      once: options.once === true,
    });
  }

  /**
   * @public Listen the next `name` and no more: `observe` with `once`.
   *
   * @param {string} name
   * @param {(note: Notification) => void} handler
   * @param {{sender?: *}} [options]
   * @returns {() => void} unsubscribes, if the notification has not come yet.
   */
  once(name, handler, options = {}) {
    return this.observe(name, handler, { ...options, once: true });
  }

  /**
   * @public Subscribe an object by naming the method to call on it — the Cocoa
   * spelling, and the one to use when the subscriptions are dropped together
   * by observer rather than one token at a time.
   *
   * The method is looked up when the notification arrives, not now, so an
   * object may define it later or replace it.
   *
   *   notifications.addObserver(this, "themeChanged", "ThemeChanged");
   *
   * @param {object} observer    what is subscribed, and what the method is
   *   called on — `removeObserver(observer)` drops it
   * @param {string|Function} method  its method's name, or a function to call
   *   with the observer as `this`
   * @param {string} name        what to hear about
   * @param {*} [sender]         hear only this object's notifications
   * @returns {() => void} unsubscribes this one subscription.
   */
  addObserver(observer, method, name, sender = null) {
    const kind = typeof observer;
    if (!observer || (kind !== "object" && kind !== "function")) {
      throw new TypeError("addObserver() needs an observer object");
    }
    if (typeof method !== "string" && typeof method !== "function") {
      throw new TypeError("addObserver() needs a method name or a function");
    }
    if (typeof name !== "string" || name === "") {
      throw new TypeError("addObserver() needs a notification name");
    }

    const handler =
      typeof method === "function"
        ? (note) => method.call(observer, note)
        : (note) => {
            const fn = observer[method];
            // Not an error: an observer may lose the method — a component that
            // was destroyed, an object rebuilt — and a notification that has
            // nowhere to go is nothing to fail the poster over.
            if (typeof fn === "function") fn.call(observer, note);
          };

    return this.#add({ name, handler, observer, sender, once: false });
  }

  /**
   * @public Drop subscriptions made with `addObserver`.
   *
   * With just an observer, every subscription it made goes — which is the call
   * to make from a `detached()`, and the reason to subscribe by observer in
   * the first place. Naming `name` or `sender` narrows it to those.
   *
   * @param {object} observer
   * @param {string} [name]   only subscriptions to this notification
   * @param {*} [sender]      only subscriptions narrowed to this sender
   * @returns {number} how many subscriptions were dropped.
   */
  removeObserver(observer, name = null, sender = undefined) {
    let dropped = 0;
    const names = name === null ? [...this.#byName.keys()] : [name];

    for (const key of names) {
      const subs = this.#byName.get(key);
      if (!subs) continue;
      const kept = subs.filter((sub) => {
        const match =
          sub.observer === observer &&
          (sender === undefined || sub.sender === sender);
        if (match) {
          // Marked as well as dropped: a post already walking this list holds
          // its own copy, and must not deliver to a subscription undone since.
          sub.dead = true;
          dropped++;
        }
        return !match;
      });
      if (kept.length > 0) this.#byName.set(key, kept);
      else this.#byName.delete(key);
    }
    return dropped;
  }

  /**
   * @public Announce that something happened, and return once every observer has been
   * told. Posting a notification nobody observes is not an error and does
   * nothing — that is the point of the arrangement.
   *
   *   notifications.post("DocumentSaved", this, { file });
   *
   * An observer that throws does not stop the ones after it: the poster asked
   * for an announcement, not for a chain of calls that has to succeed. What it
   * threw is reported and delivery continues.
   *
   * @param {string} name    what happened
   * @param {*} [sender]     what it happened to
   * @param {object} [info]  whatever else is worth saying about it
   * @returns {number} how many observers were told.
   */
  post(name, sender = null, info = {}) {
    if (typeof name !== "string" || name === "") {
      throw new TypeError("post() needs a notification name");
    }
    const subs = this.#byName.get(name);
    if (!subs || subs.length === 0) return 0;

    /** @type {Notification} */
    const note = Object.freeze({ name, sender, info: info ?? {} });

    // A copy: an observer may subscribe or unsubscribe while being told, and
    // what it changes applies to the next post rather than to this one. `dead`
    // is the exception — an unsubscription takes effect immediately, including
    // partway through this loop.
    let told = 0;
    for (const sub of [...subs]) {
      if (sub.dead) continue;
      // A subscription narrowed to a sender hears nothing else.
      if (sub.sender !== null && sub.sender !== sender) continue;
      if (sub.once) sub.undo();
      told++;
      try {
        sub.handler(note);
      } catch (e) {
        console.error(`notification "${name}" observer failed:`, e);
      }
    }
    return told;
  }

  /**
   * @public Whether anything is listening for `name` — a poster with expensive detail
   * to gather can ask before gathering it.
   *
   * @param {string} name
   * @param {*} [sender] as it would be posted, to account for subscriptions
   *   narrowed to a sender
   * @returns {boolean}
   */
  hasObservers(name, sender = null) {
    const subs = this.#byName.get(name);
    if (!subs) return false;
    return subs.some((sub) => sub.sender === null || sub.sender === sender);
  }

  /**
   * @public Every notification name something is currently observing. For a diagnostic
   * or a test; nothing in the runtime reads it.
   *
   * @returns {string[]}
   */
  observedNames() {
    return [...this.#byName.keys()];
  }

  /**
   * @public Forget every subscription. A test's way back to a clean center — an
   * application dropping everything at once is dropping subscriptions its own
   * code did not make.
   */
  removeAllObservers() {
    for (const subs of this.#byName.values()) {
      for (const sub of subs) sub.dead = true;
    }
    this.#byName.clear();
  }

  /** Record a subscription and hand back the function that undoes it. */
  #add(sub) {
    const subs = this.#byName.get(sub.name);
    if (subs) subs.push(sub);
    else this.#byName.set(sub.name, [sub]);

    sub.dead = false;
    sub.undo = () => {
      if (sub.dead) return;
      sub.dead = true;
      const current = this.#byName.get(sub.name);
      if (!current) return;
      const kept = current.filter((other) => other !== sub);
      if (kept.length > 0) this.#byName.set(sub.name, kept);
      else this.#byName.delete(sub.name);
    };
    return sub.undo;
  }
}

/**
 * The center everything shares unless it says otherwise — what `post` and
 * `observe` mean when no one made a center of their own.
 *
 *   import { notifications } from "mosaic";
 */
export const notifications = new NotificationCenter();
