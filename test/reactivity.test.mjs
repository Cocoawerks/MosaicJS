// Reactivity: what happens to the DOM when a controller's state is assigned.
//
// Build first: `mosaic compile examples/Counter_main --keep-modules` and the
// same for `examples/Counter_component` — these tests drive the two example
// applications, which are the two shapes this is about:
//
//   Counter_main       a `.ib.xml` interface whose `{bindings}` all read the
//                      controller, with Buttons inside it calling its methods.
//   Counter_component  the same interface hosting a drawn Counter, which owns its
//                      own state and redraws itself.
//
// The two are driven by different machinery and the difference matters. A
// `.ib.xml` declares its bindings, and assigning a property one reads pushes the
// new value into the nodes that hold it. A drawn component declares nothing:
// `draw()` reads what it needs, those reads are recorded, and assigning one of
// them runs `draw()` again. What a controller can and cannot reach across that
// line is most of what is checked below.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h, Component, bindText } = await import(
  "../examples/Counter_main/build/node_modules/mosaic/runtime/mosaic.js"
);
const { default: BoundPage } = await import(
  "../examples/Counter_main/build/main.ib.js"
);
const { default: BoundController } = await import(
  "../examples/Counter_main/build/AppController.js"
);

const { default: HostPage } = await import(
  "../examples/Counter_component/build/main.ib.js"
);
const { default: HostController } = await import(
  "../examples/Counter_component/build/AppController.js"
);

/** The `.ib.xml` interface whose every value is the controller's. */
function bound(options = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const controller = new BoundController(options);
  mount(BoundPage, root, {}, controller);

  return {
    root,
    owner: controller,
    count: () => root.querySelector("output").textContent,
    classes: () =>
      root
        .querySelector("output")
        .getAttribute("class")
        .split(" ")
        .filter(Boolean)
        // The last is the file's scope, which is not what any of this is about.
        .slice(0, -1),
    title: () => root.querySelector("h1").textContent,
    buttons: () => [...root.querySelectorAll("button")],
  };
}

/** The `.ib.xml` interface that hosts a drawn component instead. */
function hosting() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const controller = new HostController({ title: "Counter App" });
  mount(HostPage, root, {}, controller);

  return {
    root,
    owner: controller,
    /** The Counter's own view, which the interface drew. */
    counter: root.querySelector("output").parentNode.__ibView,
    value: () => root.querySelector("output").textContent,
    classes: () =>
      root
        .querySelector("output")
        .getAttribute("class")
        .split(" ")
        .filter(Boolean)
        .slice(0, -1),
  };
}

// --- a .ib.xml's bindings follow the controller ---------------------------------

test("assigning a bound property writes it into the node that holds it", () => {
  const mib = bound();

  assert.equal(mib.count(), "0");
  mib.owner.count = 7;
  assert.equal(mib.count(), "7");
});

test("and into a bound attribute, not only into text", () => {
  // `styleName="value {status}"` — part literal, part binding.
  const mib = bound({ limit: 3 });

  assert.deepEqual(mib.classes(), ["value"]);
  mib.owner.count = 3;
  assert.deepEqual(mib.classes(), ["value", "high"]);
  mib.owner.count = 1;
  assert.deepEqual(mib.classes(), ["value"]);
});

test("a derived value follows what it derives from", () => {
  // `status` is a getter on the controller's class, and nothing assigns it.
  // What makes it come right is that assigning `count` re-reads every binding
  // this controller holds, and `status` is read again along with the rest.
  //
  // It was frozen once: observation looked for the property on the controller
  // itself, did not find a getter that lives on its class, took it for plain
  // state and defined an own accessor over the top holding whatever the getter
  // had said the first time. The class never changed again.
  const mib = bound({ limit: 2 });

  mib.owner.count = 5;
  assert.equal(mib.owner.status, "high", "the getter still computes");
  assert.deepEqual(mib.classes(), ["value", "high"], "and the DOM has it");
});

test("every binding on a property follows it, not just the first", () => {
  const controller = { label: "one" };
  const Twice = function () {
    return h(
      "div",
      null,
      h("p", null, bindText(this, "label")),
      h("b", null, bindText(this, "label")),
    );
  };
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(Twice, root, {}, controller);

  controller.label = "two";
  assert.equal(root.querySelector("p").textContent, "two");
  assert.equal(root.querySelector("b").textContent, "two");
});

test("a property nothing binds to is left an ordinary one", () => {
  const mib = bound();

  mib.owner.untouched = 1;
  const plain = Object.getOwnPropertyDescriptor(mib.owner, "untouched");
  assert.ok("value" in plain, "no accessor was installed over it");

  // And assigning it draws nothing, since nothing reads it.
  const before = mib.root.innerHTML;
  mib.owner.untouched = 2;
  assert.equal(mib.root.innerHTML, before);
});

test("assigning the same value again changes nothing", () => {
  const mib = bound();
  mib.owner.count = 4;

  const node = mib.root.querySelector("output");
  const text = node.childNodes[0];
  mib.owner.count = 4;

  assert.equal(node.childNodes[0], text, "the same text node, untouched");
  assert.equal(mib.count(), "4");
});

test("what observation cannot see is what needsDisplay is for", () => {
  const controller = { user: { name: "ada" } };
  const Probe = function () {
    return h("p", null, bindText(this, "user.name"));
  };
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(Probe, root, {}, controller);

  // Nothing was assigned on the controller, so nothing was noticed.
  controller.user.name = "grace";
  assert.equal(root.textContent, "ada");

  controller.view.needsDisplay();
  assert.equal(root.textContent, "grace");

  // Replacing the object outright is an assignment, and needs no help.
  controller.user = { name: "hopper" };
  assert.equal(root.textContent, "hopper");
});

test("a binding whose node has gone is dropped rather than written to", () => {
  const mib = bound();
  const output = mib.root.querySelector("output");

  mib.owner.count = 1;
  output.remove();

  // The node is off the interface; assigning again must neither throw nor keep it.
  mib.owner.count = 2;
  assert.equal(output.parentNode, null);
  assert.equal(mib.title(), "Counter App", "the bindings that remain still work");
});

test("an interface driven hard does not accumulate work per assignment", () => {
  // Every draw registers its bindings again. Registering a fresh notifier each
  // time would leave one per assignment behind, and each of them would run on
  // the next — which is quadratic, and was once an out-of-memory.
  const mib = bound();

  for (let i = 0; i < 300; i += 1) mib.owner.count = i;

  assert.equal(mib.count(), "299");
  const bindings = mib.owner[Symbol.for("mosaic.bindings")];
  assert.equal(bindings.length, 3, "one per binding in the markup, still");
});

// --- a controller reaching the components inside its interface --------------------

test("a Button in the interface calls the controller, and the interface follows", () => {
  const mib = bound();
  const [minus, plus] = mib.buttons();

  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });
  assert.equal(mib.owner.count, 2);
  assert.equal(mib.count(), "2", "which the binding wrote out");

  minus.dispatchEvent({ type: "click" });
  assert.equal(mib.count(), "1");
});

test("a component's props are what the markup said, and stay that way", () => {
  // The line a controller cannot cross by assigning its own state: `<Counter
  // limit="3"/>` is a value handed over once. Nothing on the controller is
  // read by it, so nothing on the controller can change it — an application
  // that has to change one says so through an outlet, or binds the prop.
  const mib = hosting();

  assert.equal(mib.counter.limit, 3);
  mib.owner.limit = 99;
  assert.equal(mib.counter.limit, 3, "the component was not told anything");
});

// --- a drawn component observes what it drew ---------------------------------

test("assigning what draw() read draws it again", () => {
  const mib = hosting();

  assert.equal(mib.value(), "0");
  mib.counter.count = 5;
  assert.equal(mib.value(), "5");
});

test("including through a getter, which is watched by what it reads", () => {
  // `status` is a getter on the component reading `count` and `limit`. A drawn
  // view records the reads its drawing made, the getter's among them, so what
  // it derives from is what gets watched.
  const mib = hosting();

  assert.deepEqual(mib.classes(), ["value"]);
  mib.counter.count = 3;
  assert.deepEqual(mib.classes(), ["value", "high"]);
});

test("a redraw patches what it drew rather than building it again", () => {
  const mib = hosting();
  const output = mib.root.querySelector("output");

  mib.counter.count = 2;
  assert.equal(mib.root.querySelector("output"), output, "the same node");
  assert.equal(mib.value(), "2");
});

test("a component's state is its own, and its redraw is its own too", () => {
  const root = document.createElement("div");
  document.body.appendChild(root);

  class Tally extends Component {
    constructor() {
      super();
      this.n = 0;
    }
    draw() {
      return h("i", null, String(this.n));
    }
  }
  const Mib = function () {
    return h(
      "div",
      null,
      h("p", null, bindText(this, "title")),
      h(Tally, { ref: (v) => (this.first = v) }),
      h(Tally, { ref: (v) => (this.second = v) }),
    );
  };

  const controller = { title: "mib" };
  mount(Mib, root, {}, controller);
  const [first, second] = [...root.querySelectorAll("i")];

  controller.first.n = 9;
  assert.equal(first.textContent, "9");
  assert.equal(second.textContent, "0", "the other one was not drawn again");
  assert.equal(root.querySelector("p").textContent, "mib", "nor was the interface");
});

test("a component is not watching the controller that drew it", () => {
  // A drawn view watches what *it* read, and it reads its own properties. A
  // component that reaches into the controller instead is reading something
  // nobody recorded, so assigning it draws nothing — which is why what a
  // component needs is given to it as a prop or set on it directly.
  const root = document.createElement("div");
  document.body.appendChild(root);

  class Reader extends Component {
    draw() {
      return h("i", null, String(this.owner?.label ?? ""));
    }
  }
  const controller = { label: "first" };
  mount(Reader, root, {}, controller);
  assert.equal(root.textContent, "first");

  controller.label = "second";
  assert.equal(root.textContent, "first", "nothing recorded that read");

  // Said to the component, it draws.
  controller.view.needsDisplay();
  assert.equal(root.textContent, "second");
});

test("a controller drives a component it holds by assigning to it", () => {
  const mib = hosting();
  const button = mib.root.querySelector("button").__ibView;

  // What an outlet hands over is the component, and a component's declared
  // settings are ordinary properties: assigning one draws that component.
  button.text = "minus";
  assert.equal(mib.root.querySelector("button").textContent.trim(), "minus");
  assert.equal(mib.value(), "0", "and nothing else was drawn again");
});
