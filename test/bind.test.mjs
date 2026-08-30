// Bindings: one object's property following another's.
//
// Build first: `mosaic compile examples/Counter_component --keep-modules` —
// these import the compiled modules themselves.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h, Component, bind, bindTwoWay, canPush, refresh } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { Button, CheckBox, Color, ColorWell, ListView, Slider, SplitView, TextField } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** Mount a control, as an interface would. */
function control(Type, props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return mount(Type, host, props).view;
}

// --- plain objects -----------------------------------------------------------

test("a bound property follows the one it was bound to", () => {
  const source = { value: "one" };
  const target = { text: "" };

  bind(source, "value", target, "text");
  assert.equal(target.text, "one", "and agrees from the start");

  source.value = "two";
  assert.equal(target.text, "two");
});

test("the same name on both sides need not be said twice", () => {
  const source = { value: 1 };
  const target = { value: 0 };

  bind(source, "value", target);
  source.value = 7;
  assert.equal(target.value, 7);
});

test("a transform is what the value becomes on the way across", () => {
  const slider = { value: 40 };
  const label = { text: "" };

  bind(slider, "value", label, "text", (v) => `${v}%`);
  assert.equal(label.text, "40%");

  slider.value = 55;
  assert.equal(label.text, "55%");
});

test("undoing it stops the following", () => {
  const source = { value: 1 };
  const target = { value: 0 };

  const undo = bind(source, "value", target);
  source.value = 2;
  assert.equal(target.value, 2);

  undo();
  source.value = 3;
  assert.equal(target.value, 2, "left where it was");
});

test("a chain carries all the way along", () => {
  const a = { value: 1 };
  const b = { value: 0 };
  const c = { value: 0 };

  bind(a, "value", b);
  bind(b, "value", c);

  a.value = 9;
  assert.equal(b.value, 9);
  assert.equal(c.value, 9, "and not only to the first link");
});

test("binding needs two objects", () => {
  assert.throws(() => bind(null, "a", {}, "b"), /source must be an object/);
  assert.throws(() => bind({}, "a", null, "b"), /target must be an object/);
});

// --- both ways ---------------------------------------------------------------

test("bound both ways, either one moves the other", () => {
  const a = { value: "start" };
  const b = { value: "" };

  bindTwoWay(a, "value", b);
  assert.equal(
    b.value,
    "start",
    "the first is the one that wins to begin with",
  );

  a.value = "from a";
  assert.equal(b.value, "from a");

  b.value = "from b";
  assert.equal(a.value, "from b");
});

test("and settles rather than ringing", () => {
  // A component's setter is told about every assignment, changed value or not,
  // so without a guard `a` telling `b` would have `b` telling `a` for as long
  // as the stack held.
  const a = control(TextField, { value: "one" });
  const b = control(TextField, { value: "two" });

  bindTwoWay(a, "value", b);
  assert.equal(b.value, "one");

  b.value = "typed";
  assert.equal(a.value, "typed");
  assert.equal(b.value, "typed");
});

test("both ways with a transform each way", () => {
  const celsius = { value: 100 };
  const fahrenheit = { value: 0 };

  bindTwoWay(celsius, "value", fahrenheit, "value", {
    to: (c) => c * 1.8 + 32,
    from: (f) => (f - 32) / 1.8,
  });
  assert.equal(fahrenheit.value, 212);

  fahrenheit.value = 32;
  assert.equal(celsius.value, 0);
});

test("undoing a mutual binding undoes both directions", () => {
  const a = { value: 1 };
  const b = { value: 0 };

  const undo = bindTwoWay(a, "value", b);
  undo();

  a.value = 5;
  assert.equal(b.value, 1, "b keeps what it was seeded with");
  b.value = 6;
  assert.equal(a.value, 5, "and neither hears the other");
});

// --- components and controllers ----------------------------------------------

test("a control's property can be bound to a controller's", () => {
  const controller = { name: "" };
  const field = control(TextField, { value: "Ada" });

  bind(field, "value", controller, "name");
  assert.equal(controller.name, "Ada");

  field.value = "Grace";
  assert.equal(controller.name, "Grace");
});

test("and a controller's to a control's, which is what draws it", () => {
  const controller = { label: "Save" };
  const button = control(Button, { text: "" });

  bind(controller, "label", button, "text");
  assert.equal(button.text, "Save");

  controller.label = "Saving…";
  assert.equal(button.text, "Saving…", "the component was told");
  assert.equal(
    button.node.textContent.includes("Saving…"),
    true,
    "and drew itself again",
  );
});

test("one control to another, of different kinds", () => {
  const box = control(CheckBox, { value: "true" });
  const button = control(Button, { text: "" });

  bind(box, "value", button, "enabled");
  assert.equal(button.enabled, true);

  box.value = false;
  assert.equal(button.enabled, false);
});

test("a property with no setter cannot push, and says so", () => {
  // Bound from one the value is still copied across once — which is what a
  // caller reading a fixed thing wants — but never again.
  const button = control(Button, { text: "Go" });

  assert.equal(canPush(button, "text"), true);
  assert.equal(canPush(button, "focused"), false, "a derived read-only getter");

  const target = { focused: null };
  bind(button, "focused", target);
  assert.equal(target.focused, false, "copied once all the same");
});

// --- key-value coding paths --------------------------------------------------

test("either side may be named by a path from further out", () => {
  const controller = { slider: { value: 40 }, label: { text: "" } };

  bind(controller, "slider.value", controller, "label.text");
  assert.equal(controller.label.text, 40);

  controller.slider.value = 70;
  assert.equal(controller.label.text, 70);
});

test("a bare name is a property of the object itself", () => {
  const controller = { volume: 1, spin: { value: 0 } };

  bind(controller, "volume", controller, "spin.value");
  controller.volume = 9;
  assert.equal(controller.spin.value, 9);
});

test("paths go as deep as they are written", () => {
  const root = { a: { b: { c: 1 } }, out: { value: 0 } };

  bind(root, "a.b.c", root, "out.value");
  root.a.b.c = 5;
  assert.equal(root.out.value, 5);
});

test("both ways works by path too", () => {
  const controller = { slider: { value: 40 }, spin: { value: 0 } };

  bindTwoWay(controller, "slider.value", controller, "spin.value");
  assert.equal(controller.spin.value, 40);

  controller.spin.value = 15;
  assert.equal(controller.slider.value, 15);
});

test("a path is walked once, not followed", () => {
  // A binding follows a property, not a path: what `slider` held when the
  // binding was made is what stays bound.
  const controller = { slider: { value: 1 }, out: { value: 0 } };
  bind(controller, "slider.value", controller, "out.value");

  const was = controller.slider;
  controller.slider = { value: 99 };
  assert.equal(controller.out.value, 1, "the new one is not bound");

  was.value = 2;
  assert.equal(controller.out.value, 2, "the old one still is");
});

test("a path that leads nowhere says which step it lost", () => {
  const controller = { label: { text: "" } };

  assert.throws(
    () => bind(controller, "slider.value", controller, "label.text"),
    /source "slider.value" has nothing at "slider"/,
  );
  assert.throws(
    () => bind(controller, "label.text", controller, "a.b.c"),
    /target "a.b.c" has nothing at "a"/,
  );
});

test("and a missing property is refused rather than bound to nothing", () => {
  assert.throws(() => bind({}, "", {}, "x"), /source needs a property/);
  assert.throws(() => bind({ a: 1 }, "a", {}, ""), /target needs a property/);
});

test("canPush reads a path too", () => {
  const button = control(Button, { text: "Go" });
  const controller = { button };

  assert.equal(canPush(controller, "button.text"), true);
  assert.equal(canPush(controller, "button.focused"), false);
});

// --- the <Bind> tag ----------------------------------------------------------
//
// A Bind reads its paths from the interface's controller, which it finds by walking
// up from where it stands: a compiled `.ib.xml` tags the element it drew with the
// scope it drew against. Mounted here the same way, with a host that carries
// one.

const { Bind } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** An interface's element, tagged with its controller as a compiled `.ib.xml` is. */
function mib(controller) {
  const el = document.createElement("div");
  el.__ibOwner = controller;
  document.body.appendChild(el);
  return el;
}

/** Place a `<Bind/>` in that interface, as the markup would. */
function placeBind(el, props) {
  const host = document.createElement("div");
  el.appendChild(host);
  return mount(Bind, host, props);
}

test("a Bind tag joins two paths and draws nothing", () => {
  const controller = { slider: { value: 40 }, label: { value: "" } };
  const el = mib(controller);

  const placed = placeBind(el, {
    source: "slider.value",
    target: "label.value",
  });

  assert.equal(controller.label.value, 40, "joined, and agreeing at once");
  controller.slider.value = 70;
  assert.equal(controller.label.value, 70);

  // Nothing on the interface: a binding is not a thing to look at.
  assert.equal(placed.view.node.nodeType, 8, "a comment, standing for nothing");
});

test("and reaches the controller's own properties by name", () => {
  const controller = { slider: { value: 5 }, volume: 0 };
  const el = mib(controller);

  placeBind(el, { source: "slider.value", target: "volume" });
  controller.slider.value = 12;
  assert.equal(controller.volume, 12);
});

test("`twoway` makes it two-way", () => {
  const controller = { slider: { value: 40 }, spin: { value: 0 } };
  const el = mib(controller);

  placeBind(el, {
    source: "slider.value",
    target: "spin.value",
    twoway: "true",
  });
  assert.equal(controller.spin.value, 40, "the source wins to begin with");

  controller.spin.value = 15;
  assert.equal(controller.slider.value, 15, "and the target pushes back");
});

test("a Bind that leaves the interface takes its binding with it", () => {
  const controller = { a: { value: 1 }, b: { value: 0 } };
  const el = mib(controller);

  const placed = placeBind(el, { source: "a.value", target: "b.value" });
  controller.a.value = 2;
  assert.equal(controller.b.value, 2);

  placed();
  controller.a.value = 3;
  assert.equal(controller.b.value, 2, "left where it was");
});

test("a Bind outside anything with a controller says so", () => {
  const loose = document.createElement("div");
  document.body.appendChild(loose);

  assert.throws(
    () => mount(Bind, loose, { source: "a.b", target: "c.d" }),
    /not inside anything that has a controller/,
  );
});

test("and one missing half of the join says that too", () => {
  const el = mib({ a: { value: 1 } });
  assert.throws(
    () => placeBind(el, { source: "a.value" }),
    /needs both a source and a target/,
  );
});

test("a Bind written beside the markup it joins, not inside it", () => {
  // An interface's roots all belong to that interface, so a `<Bind/>` written after the
  // markup rather than within it must still find the controller by looking
  // upward. Only the first root used to carry the scope, so this — the way the
  // tags read best — was the one shape that could not find it.
  const controller = { a: { value: 1 }, b: { value: 0 } };

  function Mib() {
    return [
      h("div", { class: "content" }),
      h(Bind, { source: "a.value", target: "b.value" }),
    ];
  }
  Mib.owner = function () {
    return controller;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host);

  assert.equal(controller.b.value, 1, "joined from a second root");
  controller.a.value = 4;
  assert.equal(controller.b.value, 4);
});

test("and inside a component, whose controller serves as well", () => {
  // An interface written as a class rather than as markup has a controller too.
  const controller = { a: { value: 3 }, b: { value: 0 } };

  class Panel extends Component {
    draw() {
      return h("div", {}, h(Bind, { source: "a.value", target: "b.value" }));
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Panel, host, {}, controller);

  assert.equal(controller.b.value, 3);
});

test("a path that is not ready yet is waited for, not refused", () => {
  // An outlet is assigned as the markup draws, so ordinarily everything a Bind
  // names exists by the time it attaches. Not always — a control inside
  // something drawn later, an outlet assigned by hand — and a Bind that
  // refused those would be refusing a path that is about to be good. The head
  // of the path is watched instead, and the join made when it turns up.
  const controller = { b: { value: 0 } };

  function Mib() {
    return [
      h(Bind, { source: "a.value", target: "b.value" }),
      h(Bind, { source: "a.other", target: "b.other" }),
    ];
  }
  Mib.owner = function () {
    return controller;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host);

  assert.equal(controller.b.value, 0, "nothing to join to yet, and no error");

  // Put it there, and both join at once — no waiting on a tick.
  controller.a = { value: 7, other: "x" };
  assert.equal(controller.b.value, 7);
  assert.equal(controller.b.other, "x", "and the one beside it");

  controller.a.value = 9;
  assert.equal(controller.b.value, 9, "a live binding, not a copy");
});

test("a path that never leads anywhere says so once, and keeps watching", () => {
  // Said rather than thrown: a binding that did not happen is not worth taking
  // an application down for, and an interface that threw here would take one down on
  // load.
  const controller = { combo2: { value: 1 }, label: { value: 0 } };
  const said = [];
  const wasError = console.error;
  console.error = (...args) => said.push(args.join(" "));

  function Mib() {
    return h(Bind, { source: "combo1.value", target: "label.value" });
  }
  Mib.owner = function () {
    return controller;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host);

  return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
    console.error = wasError;

    assert.equal(said.length, 1, "said once");
    assert.match(said[0], /has nothing at "combo1"/);
    assert.match(said[0], /The controller has: combo2, label\./);
    assert.match(said[0], /Still watching/);

    // And it means it: the binding is made if the outlet ever turns up.
    controller.combo1 = { value: "late" };
    assert.equal(controller.label.value, "late");
  });
});

test("a control changing its own value tells what is bound to it", () => {
  // A component keeps its settings in a bag of its own and writes them through
  // `Component.set`, which never goes near the accessor an observer wrapped.
  // So a control changed the way a user changes it — through its own method,
  // not by assigning to the property — was invisible to everything watching.
  const field = control(TextField, { value: "one" });
  const controller = { name: "" };

  bind(field, "value", controller, "name");
  assert.equal(controller.name, "one");

  // Not `field.value = …`, which is the path that always worked.
  field.setValue("two", true);
  assert.equal(controller.name, "two");
});

// --- scope ---------------------------------------------------------------
//
// A path is read against the scope of the `.ib.xml` the tag is written in, and
// that scope alone. A `.ib.xml` and its controller are one namespace — outlets are
// assigned onto the controller — so a path reaches the interface's own state and the
// controls it placed by the same names. It reaches nothing else: a composed
// `.ib.xml` keeps a scope of its own, and is named through the outlet it was
// placed under.

test("a path is read against the scope the tag is written in", () => {
  // Two scopes, each with a `tally`. The Bind belongs to the inner one and
  // must leave the outer one alone.
  const outer = { tally: "outer" };
  const inner = { field: { value: "inner" }, tally: "" };

  function Panel() {
    return [
      h("div", { class: "panel" }),
      h(Bind, { source: "field.value", target: "tally" }),
    ];
  }
  Panel.owner = function () {
    return inner;
  };

  function Mib() {
    return h("div", {}, h(Panel, {}));
  }
  Mib.owner = function () {
    return outer;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host);

  assert.equal(inner.tally, "inner", "the scope it was written in");
  assert.equal(outer.tally, "outer", "and not the one above it");
});

test("an interface names a composed view's control through the outlet it placed", () => {
  const inner = { combo: { value: "Red" } };
  const mib = { chosen: "" };

  function Panel() {
    return h("div", { class: "panel" });
  }
  Panel.owner = function () {
    return inner;
  };

  function Mib() {
    return [
      h("div", {}, h(Panel, { ref: (view) => (mib.mydialog = view) })),
      h(Bind, { source: "mydialog.combo.value", target: "chosen" }),
    ];
  }
  Mib.owner = function () {
    return mib;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host);

  assert.equal(mib.chosen, "Red", "reached through the outlet");
  inner.combo.value = "Blue";
  assert.equal(mib.chosen, "Blue", "and stays joined");
});

test("a Bind survives being drawn again", () => {
  // A Bind draws nothing, and drawing nothing twice is not a change. The
  // patcher used to take it for one: it put a fresh comment where the Bind's
  // was and released the component along with the old node, which undid the
  // binding. Nothing said so — the tag was still in the markup and the interface
  // had simply stopped following anything.
  const controller = { slider: { value: 40 }, label: { value: "" } };
  const el = mib(controller);

  const placed = placeBind(el, {
    source: "slider.value",
    target: "label.value",
  });

  const node = placed.view.node;
  placed.view.needsDisplay();

  assert.equal(placed.view.node, node, "the same comment stands for it");
  assert.equal(placed.view.isAttached, true, "and it is still on the interface");

  controller.slider.value = 70;
  assert.equal(controller.label.value, 70, "still joined");
});

test("and survives the redraw of the interface it is written in", () => {
  // The way that happens for real: an interface with a bound prop redraws, hands
  // every child its props again, and each Bind among them is asked to draw.
  const controller = { field: { value: "one" }, tally: "", ready: false };

  function Mib() {
    return h(
      "div",
      { class: "mib" },
      h("span", null, String(this.ready)),
      h(Bind, { source: "field.value", target: "tally" }),
    );
  }
  Mib.owner = function () {
    return controller;
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(Mib, host).view;

  assert.equal(controller.tally, "one", "joined to begin with");

  view.needsDisplay();
  controller.field.value = "two";
  assert.equal(controller.tally, "two", "and still joined afterwards");

  // And again: the second redraw must not undo it either.
  view.needsDisplay();
  controller.field.value = "three";
  assert.equal(controller.tally, "three");
});

// --- a value that lives somewhere other than the property ---------------------

test("a slider dragged by its knob tells what is bound to it", () => {
  // A Slider's `value` is a getter over the knob that holds it, so a drag
  // never assigns the property — it moves the knob and asks the slider to
  // redraw. Nothing was assigned, so nothing watching the property heard
  // anything, and a binding onto a slider followed it only when the value was
  // set from code. Dragging it — the one thing a slider is for — did nothing.
  const slider = control(Slider, { minValue: 0, maxValue: 100, value: 40 });
  const controller = { level: 0 };

  bind(slider, "value", controller, "level");
  assert.equal(controller.level, 40, "seeded from the slider");

  // What a drag does, and what an arrow key does: the knob moves and reports.
  slider.handles[0].setValue(70, true);
  assert.equal(slider.value, 70);
  assert.equal(controller.level, 70, "and the binding followed");

  // And a move that is not the user's — a drag with `continuous` off reports
  // only at rest — still counts as the value having changed.
  slider.handles[0].setValue(15, false);
  assert.equal(controller.level, 15);
});

test("and so does one moved through its own setValue", () => {
  const slider = control(Slider, { minValue: 0, maxValue: 100, value: 10 });
  const target = { value: 0 };

  bind(slider, "value", target);
  slider.setValue(80, true);
  assert.equal(target.value, 80);
});

// The same shape as the slider, in the other controls that keep what they are
// worth somewhere other than the property an interface binds. Each of these follows
// the value being changed the way the user changes it, not the way code does —
// assigning the property has always worked, because that is the assignment
// observation wraps.

test("a colour well tells what is bound to it when a colour is picked", () => {
  const well = control(ColorWell, {});
  const controller = { chosen: null };

  bind(well, "color", controller, "chosen");

  // What picking one comes to: the well is told, and reports it.
  well.setColor(Color.fromHex("#ff0000"), true);
  assert.equal(controller.chosen.toString(), well.color.toString());
  assert.equal(String(controller.chosen).includes("255"), true);
});

test("a list tells what is bound to its content and its count", () => {
  const list = control(ListView, {});
  const controller = { rows: null, howMany: -1, waiting: null };

  bind(list, "content", controller, "rows");
  bind(list, "count", controller, "howMany");
  bind(list, "isLoading", controller, "waiting");
  assert.equal(controller.howMany, 0, "seeded empty");

  list.content = ["a", "b"];
  assert.deepEqual(controller.rows, ["a", "b"]);
  assert.equal(controller.howMany, 2);

  list.add("c");
  assert.equal(controller.howMany, 3, "and after a row is added");

  list.remove("a");
  assert.equal(controller.howMany, 2, "and after one is taken away");

  list.setLoading(true);
  assert.equal(controller.waiting, true);
});

test("a split view tells what is bound to its pane length", () => {
  const split = control(SplitView, { staticPaneLength: 200 });
  const controller = { width: 0 };

  bind(split, "paneLength", controller, "width");
  assert.equal(controller.width, 200, "seeded from the markup");

  // What a drag comes to, frame by frame.
  split.setStaticPaneLength(320);
  assert.equal(controller.width, 320);

  split.collapse();
  assert.equal(controller.width, 0, "shut away is worth nothing");

  split.expand();
  assert.equal(controller.width, 320, "and as long as it was on the way back");
});
