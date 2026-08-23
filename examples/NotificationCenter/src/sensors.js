// The application's model: two sensors, and the notifications they post.
//
// Nothing here is a view, imports a view, or knows that one exists. A sensor
// takes a reading and announces it; whether anything is listening is not its
// business, and it behaves the same either way. That is the whole point of the
// arrangement — the panels in this application are wired to *this* file, never
// to each other.
//
// The names are constants rather than string literals at every call site: a
// notification name is a contract between modules that never meet, and a typo
// in one of them is a subscription that silently never fires.
import { notifications } from "mosaic";

/** A sensor took a reading. `info` carries `{ place, celsius }`. */
export const READING_TAKEN = "ReadingTaken";

/** A reading crossed the warm threshold, either way. `info` is `{ place, warm }`. */
export const THRESHOLD_CROSSED = "ThresholdCrossed";

/** Above this, a sensor calls itself warm. */
export const WARM = 25;

/**
 * One sensor. It holds a reading and posts when the reading changes — that is
 * all it does, and all it can do: it has no reference to anything that reacts.
 */
export class Sensor {
  /** @param {string} place What this sensor is measuring. */
  constructor(place) {
    this.place = place;
    this.celsius = 18;
    this.warm = false;
  }

  /**
   * Take a reading and announce it.
   *
   * `this` is passed as the notification's sender, which is what makes a
   * sender-narrowed subscription possible: an observer that imported this
   * sensor can ask to hear this one and not the other, without either sensor
   * knowing it was singled out.
   *
   * The second notification is posted only when the answer actually changes.
   * A poster deciding what is worth announcing is the poster's job — an
   * observer should not have to filter out news that is not news.
   *
   * @param {number} celsius The reading.
   */
  read(celsius) {
    this.celsius = Number(celsius);
    notifications.post(READING_TAKEN, this, {
      place: this.place,
      celsius: this.celsius,
    });

    const warm = this.celsius >= WARM;
    if (warm !== this.warm) {
      this.warm = warm;
      notifications.post(THRESHOLD_CROSSED, this, { place: this.place, warm });
    }
  }
}

/**
 * The two sensors the application has. A module that wants to watch one
 * imports it from here; a module that only wants to hear the notification
 * imports nothing at all.
 */
export const kitchen = new Sensor("Kitchen");
export const garage = new Sensor("Garage");

/** By the name a view's attribute would give — `watch="kitchen"`. */
export const sensors = { kitchen, garage };
