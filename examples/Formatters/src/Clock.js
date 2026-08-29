/**
 * An object with something to start and something to stop — which is what the
 * lifecycle an object tag gets is for.
 *
 *   <Clock outlet="clock" interval="1000"/>
 *
 * `awakeFromMib()` is called once the page is on screen, the same hook a
 * controller gets and for the same reason: everything the markup placed exists
 * by then. `detached()` is called when the page goes, which is where a timer,
 * a socket or a subscription is given back. There is no `attached()` here —
 * that is a component's hook, and this is not on the page.
 *
 * `now` is an ordinary property, so a `<Bind/>` can follow it: assigning it is
 * what the runtime observes, and nothing here has to know who is listening.
 */
export default class Clock {
  constructor() {
    /** @type {number} Milliseconds between ticks; the tag says so. */
    this.interval = 1000;
    /** @type {Date} The last tick. Followed by a `<Bind/>` in the markup. */
    this.now = new Date();
    /** @type {number} How many times it has ticked since the page opened. */
    this.ticks = 0;
    this.timer = null;
  }

  /** The page is on screen: start. */
  awakeFromMib() {
    this.timer = setInterval(() => this.tick(), Number(this.interval) || 1000);
  }

  /** And the page has gone: stop, or the timer outlives the page it served. */
  detached() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    this.ticks += 1;
    // Assigned rather than mutated: a new Date is a new value, and a value is
    // what a binding hears about. Writing into the old one would change what
    // it says and tell nobody.
    this.now = new Date();
  }
}
