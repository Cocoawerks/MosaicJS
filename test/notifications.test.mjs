// The notification center: posting to observers that were never introduced.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NotificationCenter,
  notifications,
} from "../src/js/core/runtime/NotificationCenter.js";

/** A center of its own per test, so nothing leaks between them. */
const center = () => new NotificationCenter();

test("an observer hears what is posted", () => {
  const c = center();
  const heard = [];
  c.observe("Saved", (note) => heard.push(note));

  assert.equal(c.post("Saved", "doc", { file: "a.txt" }), 1);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].name, "Saved");
  assert.equal(heard[0].sender, "doc");
  assert.deepEqual(heard[0].info, { file: "a.txt" });
});

test("a notification is frozen, and defaults to no sender and no info", () => {
  const c = center();
  let note;
  c.observe("Ping", (n) => (note = n));
  c.post("Ping");

  assert.equal(note.sender, null);
  assert.deepEqual(note.info, {});
  assert.ok(Object.isFrozen(note));
});

test("posting to nobody does nothing", () => {
  const c = center();
  assert.equal(c.post("Nobody"), 0);
  assert.equal(c.hasObservers("Nobody"), false);
});

test("observers are told in the order they subscribed", () => {
  const c = center();
  const order = [];
  c.observe("Go", () => order.push("first"));
  c.observe("Go", () => order.push("second"));
  c.observe("Go", () => order.push("third"));

  assert.equal(c.post("Go"), 3);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("the returned function unsubscribes, and twice is harmless", () => {
  const c = center();
  let count = 0;
  const undo = c.observe("Tick", () => count++);

  c.post("Tick");
  undo();
  undo();
  c.post("Tick");

  assert.equal(count, 1);
  assert.deepEqual(c.observedNames(), []);
});

test("a subscription narrowed to a sender hears only that sender", () => {
  const c = center();
  const mine = {};
  const theirs = {};
  const heard = [];
  c.observe("Changed", (n) => heard.push(n.sender), { sender: mine });

  c.post("Changed", theirs);
  c.post("Changed", mine);
  c.post("Changed");

  assert.deepEqual(heard, [mine]);
});

test("hasObservers accounts for sender-narrowed subscriptions", () => {
  const c = center();
  const model = {};
  c.observe("Changed", () => {}, { sender: model });

  assert.equal(c.hasObservers("Changed", model), true);
  assert.equal(c.hasObservers("Changed", {}), false);
  assert.equal(c.hasObservers("Changed"), false);
  assert.equal(c.hasObservers("Other", model), false);
});

test("once hears one notification and then lets go", () => {
  const c = center();
  let count = 0;
  c.once("Ready", () => count++);

  c.post("Ready");
  c.post("Ready");

  assert.equal(count, 1);
  assert.deepEqual(c.observedNames(), []);
});

test("addObserver calls the named method on the observer", () => {
  const c = center();
  const view = {
    seen: null,
    self: null,
    themeChanged(note) {
      this.seen = note.info.name;
      this.self = this;
    },
  };
  c.addObserver(view, "themeChanged", "ThemeChanged");
  c.post("ThemeChanged", null, { name: "aristo" });

  assert.equal(view.seen, "aristo");
  assert.equal(view.self, view, "the method is called on the observer");
});

test("the method is looked up at delivery, and a missing one is not an error", () => {
  const c = center();
  const view = {};
  c.addObserver(view, "later", "Late");

  assert.equal(c.post("Late"), 1, "delivery was attempted");

  let called = false;
  view.later = () => (called = true);
  c.post("Late");
  assert.equal(called, true, "the method defined afterwards is found");
});

test("removeObserver drops every subscription an observer made", () => {
  const c = center();
  const view = { a() {}, b() {} };
  c.addObserver(view, "a", "One");
  c.addObserver(view, "b", "Two");
  const other = { a() {} };
  c.addObserver(other, "a", "One");

  assert.equal(c.removeObserver(view), 2);
  assert.deepEqual(c.observedNames(), ["One"]);
  assert.equal(c.hasObservers("One"), true, "the other observer stayed");
});

test("removeObserver can be narrowed to a name and a sender", () => {
  const c = center();
  const view = { a() {} };
  const model = {};
  c.addObserver(view, "a", "One");
  c.addObserver(view, "a", "One", model);
  c.addObserver(view, "a", "Two");

  assert.equal(c.removeObserver(view, "One", model), 1);
  assert.equal(c.hasObservers("One"), true);
  assert.equal(c.removeObserver(view, "One"), 1);
  assert.deepEqual(c.observedNames(), ["Two"]);
});

test("an observer that throws does not stop the ones after it", (t) => {
  const c = center();
  t.mock.method(console, "error", () => {});
  let reached = false;
  c.observe("Boom", () => {
    throw new Error("observer failed");
  });
  c.observe("Boom", () => (reached = true));

  assert.equal(c.post("Boom"), 2);
  assert.equal(reached, true);
  assert.equal(console.error.mock.callCount(), 1);
});

test("subscribing during a post applies to the next one", () => {
  const c = center();
  let added = 0;
  c.observe("Wave", () => {
    c.observe("Wave", () => added++);
  });

  c.post("Wave");
  assert.equal(added, 0, "the new observer did not hear the post that made it");
  c.post("Wave");
  assert.equal(added, 1);
});

test("unsubscribing during a post takes effect immediately", () => {
  const c = center();
  let later = 0;
  const undo = [];
  c.observe("Stop", () => undo.forEach((f) => f()));
  undo.push(c.observe("Stop", () => later++));

  assert.equal(c.post("Stop"), 1, "the dropped observer was not told");
  assert.equal(later, 0);
});

test("removeAllObservers empties the center", () => {
  const c = center();
  const view = { a() {} };
  c.observe("One", () => {});
  c.addObserver(view, "a", "Two");

  c.removeAllObservers();
  assert.deepEqual(c.observedNames(), []);
  assert.equal(c.post("One"), 0);
  assert.equal(c.post("Two"), 0);
});

test("centers are independent of each other", () => {
  const a = center();
  const b = center();
  let heard = 0;
  a.observe("Shared", () => heard++);

  b.post("Shared");
  assert.equal(heard, 0);
  a.post("Shared");
  assert.equal(heard, 1);
});

test("the default center is one shared NotificationCenter", () => {
  assert.ok(notifications instanceof NotificationCenter);

  let heard = 0;
  const undo = notifications.observe("DefaultCenterTest", () => heard++);
  notifications.post("DefaultCenterTest");
  undo();

  assert.equal(heard, 1);
  assert.equal(notifications.hasObservers("DefaultCenterTest"), false);
});

test("bad arguments are refused rather than silently ignored", () => {
  const c = center();
  assert.throws(() => c.observe("", () => {}), TypeError);
  assert.throws(() => c.observe("X"), TypeError);
  assert.throws(() => c.post(""), TypeError);
  assert.throws(() => c.addObserver(null, "m", "X"), TypeError);
  assert.throws(() => c.addObserver({}, 1, "X"), TypeError);
  assert.throws(() => c.addObserver({}, "m", ""), TypeError);
});
