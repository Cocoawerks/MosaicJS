// Declared settings: `static props` turning into accessors.
// Build first: `mosaic compile examples/Counter_component --keep-modules`.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { Component } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);

test("a declared setting reads as the type it was declared to be", () => {
  class Thing extends Component {
    static props = {
      text: { type: String },
      on: { type: Boolean, default: false },
      size: { type: Number, default: 5 },
    };
  }
  const t = new Thing();

  // Nothing said: the declared default.
  assert.equal(t.on, false);
  assert.equal(t.size, 5);
  assert.equal(t.text, undefined);

  // Markup has only text to say a boolean or a number with.
  t.props = { text: "hi", on: "false", size: "12" };
  assert.equal(t.text, "hi");
  assert.equal(t.on, false, '"false" is false, not a truthy string');
  assert.equal(t.size, 12);
  assert.equal(typeof t.size, "number");

  // Assigning goes through the same cast.
  t.on = "true";
  assert.equal(t.on, true);
  t.size = "7";
  assert.equal(t.size, 7);
  assert.equal(typeof t.size, "number");
});

test("a subclass inherits its parent's settings and may narrow them", () => {
  class Base extends Component {
    static props = { size: { type: Number, default: 1 }, on: { type: Boolean } };
  }
  class Narrow extends Base {
    static props = { size: { type: Number, default: 9 } };
  }
  assert.equal(new Base().size, 1);
  assert.equal(new Narrow().size, 9);
  assert.equal(new Narrow().on, undefined, "the parent's other settings come too");
});

test("a hand-written accessor wins over the declared one", () => {
  const seen = [];
  class Written extends Component {
    static props = { size: { type: Number, default: 0 } };
    get size() {
      return 42;
    }
    set size(value) {
      seen.push(value);
    }
  }
  const w = new Written();
  w.props = { size: "3" };
  assert.equal(w.size, 42, "the hand-written getter is not replaced");
  w.size = 8;
  assert.deepEqual(seen, [8], "nor the setter");
});

test("half a hand-written accessor keeps the other half", () => {
  // Writing only the setter shadows the inherited getter in plain JavaScript;
  // the declaration fills the missing half back in.
  const seen = [];
  class HalfSet extends Component {
    static props = { size: { type: Number, default: 4 } };
    set size(value) {
      seen.push(value);
      this.set("size", Number(value) * 2);
    }
  }
  const h = new HalfSet();
  assert.equal(h.size, 4, "the getter still answers");
  h.size = "5";
  assert.deepEqual(seen, ["5"]);
  assert.equal(h.size, 10, "and reads what the hand-written setter stored");

  class HalfGet extends Component {
    static props = { size: { type: Number, default: 4 } };
    get size() {
      return 99;
    }
  }
  const g = new HalfGet();
  assert.equal(g.size, 99);
  g.size = "6";
  assert.equal(g.get("size"), 6, "the filled-in setter still casts and stores");
});

test("a setting may not take a name the component needs", () => {
  class Clash extends Component {
    static props = { click: { type: String } };
  }
  assert.throws(() => new Clash(), /cannot be a setting/);

  // Only a prototype-level data property can be caught from here — a field
  // assigned in a constructor is set after the accessors are defined.
  class Shadowed extends Component {
    static props = { size: { type: Number } };
  }
  Object.defineProperty(Shadowed.prototype, "size", { value: 3, writable: true });
  assert.throws(() => new Shadowed(), /also a/);
});
