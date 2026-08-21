// Reactivity: what happens to the DOM when a controller's state is assigned.
//
// Build first: `mosaic compile examples/Counter_main --keep-modules` and the
// same for `examples/Counter_component` — these tests drive the two example
// applications, which are the two shapes this is about:
//
//   Counter_main       a `.mib` page whose `{bindings}` all read the
//                      controller, with Buttons inside it calling its methods.
//   Counter_component  the same page hosting a drawn Counter, which owns its
//                      own state and redraws itself.
//
// The two are driven by different machinery and the difference matters. A
// `.mib` declares its bindings, and assigning a property one reads pushes the
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
  "../examples/Counter_main/build/src/main.mib.js"
);
const { default: BoundController } = await import(
  "../examples/Counter_main/build/src/AppController.js"
);

const { default: HostPage } = await import(
  "../examples/Counter_component/build/src/main.mib.js"
);
const { default: HostController } = await import(
  "../examples/Counter_component/build/src/AppController.js"
);

/** The `.mib` page whose every value is the controller's. */
function bound(options = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const controller = new BoundController(options);
  mount(BoundPage, root, {}, controller);

  return {
    root,
    controller,
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

/** The `.mib` page that hosts a drawn component instead. */
function hosting() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const controller = new HostController({ title: "Counter App" });
  mount(HostPage, root, {}, controller);

  return {
    root,
    controller,
    /** The Counter's own view, which the page drew. */
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

// --- a .mib's bindings follow the controller ---------------------------------

test("assigning a bound property writes it into the node that holds it", () => {
  const page = bound();

  assert.equal(page.count(), "0");
  page.controller.count = 7;
  assert.equal(page.count(), "7");
});

test("and into a bound attribute, not only into text", () => {
  // `styleName="value {status}"` — part literal, part binding.
  const page = bound({ limit: 3 });

  assert.deepEqual(page.classes(), ["value"]);
  page.controller.count = 3;
  assert.deepEqual(page.classes(), ["value", "high"]);
  page.controller.count = 1;
  assert.deepEqual(page.classes(), ["value"]);
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
  const page = bound({ limit: 2 });

  page.controller.count = 5;
  assert.equal(page.controller.status, "high", "the getter still computes");
  assert.deepEqual(page.classes(), ["value", "high"], "and the DOM has it");
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
  const page = bound();

  page.controller.untouched = 1;
  const plain = Object.getOwnPropertyDescriptor(page.controller, "untouched");
  assert.ok("value" in plain, "no accessor was installed over it");

  // And assigning it draws nothing, since nothing reads it.
  const before = page.root.innerHTML;
  page.controller.untouched = 2;
  assert.equal(page.root.innerHTML, before);
});

test("assigning the same value again changes nothing", () => {
  const page = bound();
  page.controller.count = 4;

  const node = page.root.querySelector("output");
  const text = node.childNodes[0];
  page.controller.count = 4;

  assert.equal(node.childNodes[0], text, "the same text node, untouched");
  assert.equal(page.count(), "4");
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
  const page = bound();
  const output = page.root.querySelector("output");

  page.controller.count = 1;
  output.remove();

  // The node is off the page; assigning again must neither throw nor keep it.
  page.controller.count = 2;
  assert.equal(output.parentNode, null);
  assert.equal(page.title(), "Counter App", "the bindings that remain still work");
});

test("a page driven hard does not accumulate work per assignment", () => {
  // Every draw registers its bindings again. Registering a fresh notifier each
  // time would leave one per assignment behind, and each of them would run on
  // the next — which is quadratic, and was once an out-of-memory.
  const page = bound();

  for (let i = 0; i < 300; i += 1) page.controller.count = i;

  assert.equal(page.count(), "299");
  const bindings = page.controller[Symbol.for("mosaic.bindings")];
  assert.equal(bindings.length, 3, "one per binding in the markup, still");
});

// --- a controller reaching the components inside its page --------------------

test("a Button in the page calls the controller, and the page follows", () => {
  const page = bound();
  const [minus, plus] = page.buttons();

  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });
  assert.equal(page.controller.count, 2);
  assert.equal(page.count(), "2", "which the binding wrote out");

  minus.dispatchEvent({ type: "click" });
  assert.equal(page.count(), "1");
});

test("a component's props are what the markup said, and stay that way", () => {
  // The line a controller cannot cross by assigning its own state: `<Counter
  // limit="3"/>` is a value handed over once. Nothing on the controller is
  // read by it, so nothing on the controller can change it — an application
  // that has to change one says so through an outlet, or binds the prop.
  const page = hosting();

  assert.equal(page.counter.limit, 3);
  page.controller.limit = 99;
  assert.equal(page.counter.limit, 3, "the component was not told anything");
});

// --- a drawn component observes what it drew ---------------------------------

test("assigning what draw() read draws it again", () => {
  const page = hosting();

  assert.equal(page.value(), "0");
  page.counter.count = 5;
  assert.equal(page.value(), "5");
});

test("including through a getter, which is watched by what it reads", () => {
  // `status` is a getter on the component reading `count` and `limit`. A drawn
  // view records the reads its drawing made, the getter's among them, so what
  // it derives from is what gets watched.
  const page = hosting();

  assert.deepEqual(page.classes(), ["value"]);
  page.counter.count = 3;
  assert.deepEqual(page.classes(), ["value", "high"]);
});

test("a redraw patches what it drew rather than building it again", () => {
  const page = hosting();
  const output = page.root.querySelector("output");

  page.counter.count = 2;
  assert.equal(page.root.querySelector("output"), output, "the same node");
  assert.equal(page.value(), "2");
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
  const Page = function () {
    return h(
      "div",
      null,
      h("p", null, bindText(this, "title")),
      h(Tally, { ref: (v) => (this.first = v) }),
      h(Tally, { ref: (v) => (this.second = v) }),
    );
  };

  const controller = { title: "page" };
  mount(Page, root, {}, controller);
  const [first, second] = [...root.querySelectorAll("i")];

  controller.first.n = 9;
  assert.equal(first.textContent, "9");
  assert.equal(second.textContent, "0", "the other one was not drawn again");
  assert.equal(root.querySelector("p").textContent, "page", "nor was the page");
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
      return h("i", null, String(this.controller?.label ?? ""));
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
  const page = hosting();
  const button = page.root.querySelector("button").__ibView;

  // What an outlet hands over is the component, and a component's declared
  // settings are ordinary properties: assigning one draws that component.
  button.text = "minus";
  assert.equal(page.root.querySelector("button").textContent.trim(), "minus");
  assert.equal(page.value(), "0", "and nothing else was drawn again");
});
