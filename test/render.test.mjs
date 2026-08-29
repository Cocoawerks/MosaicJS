// End-to-end check: compiled output + runtime produce the expected DOM, and a
// controller drives every update afterwards.
// Uses a tiny DOM shim so the test runs on plain node, no browser needed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import "./dom-shim.mjs";

// Every module is imported up front: a later top-level `await import` would
// yield, letting queued tests run before its bindings exist.
//
// The runtime comes from the app's own build, not from src/: each application
// vendors a copy, and `instanceof` only holds against the copy its modules
// were compiled against.
//
// Build first, with the modules kept — a plain compile leaves only the bundle,
// which is all an interface needs, while these tests read what it was built from:
//
//   mosaic compile examples/Counter_component --keep-modules
//   mosaic compile examples/Counter_main --keep-modules
const {
  mount,
  h,
  Fragment,
  refresh,
  Component,
  MosaicApplication,
  bindText: bindTextRef,
} = await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { default: Main } =
  await import("../examples/Counter_component/build/main.ib.js");
const { Button } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");
const { addStyles } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");

// A drawn view for the tests below to exercise: the shape the compiler emits
// for a `draw()` full of JSX, written out by hand.
//
// It belongs to the tests rather than to an example app. What these tests are
// about is the runtime — mounting, redrawing, patching — and an example is
// free to be rewritten without taking them with it. That the compiler produces
// this shape is the compiler tests' business.
const COUNTER_SCOPE = "ctr1abc";
addStyles("counter", `.counter.${COUNTER_SCOPE}{display:flex}`);

class CounterView extends Component {
  constructor() {
    super();
    this.count = 0;
  }

  get limit() {
    return Number(this.props.limit ?? 3);
  }

  get status() {
    return this.count >= this.limit ? "high" : "";
  }

  increment() {
    this.count += 1;
  }

  decrement() {
    this.count -= 1;
  }

  draw() {
    return h(
      "div",
      { class: `counter ${COUNTER_SCOPE}` },
      h(Button, { text: "-", action: (...a) => this.decrement(...a) }),
      h(
        "output",
        { class: `value ${this.status} ${COUNTER_SCOPE}`.replace(/\s+/g, " ") },
        String(this.count),
      ),
      h(Button, {
        text: "+",
        intent: "primary",
        action: (...a) => this.increment(...a),
      }),
    );
  }
}

// A plain class — the view is handed to it as `this.view` by mount().
// The interface controller for main.ib.xml: `{title}` reads this.
class PageController {
  constructor(title = "Mosaic") {
    this.title = title;
  }
}

test("renders markup with scope attributes and injected styles", () => {
  const root = document.createElement("div");
  mount(Main, root, {}, new PageController());

  assert.match(root.innerHTML, /^<div class="app [a-z][a-z0-9]*">/);
  assert.match(root.innerHTML, /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/);
  // Directives never reach the DOM.
  assert.equal(root.innerHTML.includes("outlet"), false);
  assert.equal(root.innerHTML.includes("action"), false);
  assert.equal(root.innerHTML.includes("styleName"), false);

  const css = document.head.childNodes.map((n) => n.textContent).join("");
  assert.match(css, /\.app\.[a-z][a-z0-9]*/);
});

test("{path} renders the controller value at mount", () => {
  const root = document.createElement("div");
  mount(Main, root, {}, new PageController("Groceries"));
  assert.match(root.innerHTML, /<h1[^>]*>Groceries<\/h1>/);
});

test("view.needsDisplay() pushes what observation cannot see", () => {
  // Observation wraps the property, so replacing `user` is noticed. Mutating
  // the object it holds is not — nothing was assigned on the controller. That
  // is what needsDisplay() remains for.
  const controller = { user: { name: "ada" } };
  const Probe = function () {
    return h("p", null, bindTextRef(this, "user.name"));
  };
  const root = document.createElement("div");
  mount(Probe, root, {}, controller);

  controller.user.name = "grace";
  assert.match(root.innerHTML, />ada</, "an in-place mutation is invisible");
  controller.view.needsDisplay();
  assert.match(root.innerHTML, />grace</);

  // Replacing it outright is an assignment, and needs nothing further.
  controller.user = { name: "hopper" };
  assert.match(root.innerHTML, />hopper</);
});

test("a missing or nullish path renders as empty text", () => {
  const root = document.createElement("div");
  mount(Main, root, {}, {});
  assert.match(root.innerHTML, /<h1[^>]*><\/h1>/);
});

test("dotted paths read through nested objects", () => {
  const controller = { user: { name: "ada" } };
  const Probe = function () {
    return h("p", null, bindTextRef(this, "user.name"));
  };
  const root = document.createElement("div");
  mount(Probe, root, {}, controller);
  assert.match(root.innerHTML, />ada</);

  controller.user.name = "grace";
  refresh(controller);
  assert.match(root.innerHTML, />grace</);
});

test("an action prop calls the named method on the view that drew it", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;

  const [minus, plus] = root.querySelectorAll("button");
  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });
  assert.equal(view.count, 2);

  minus.dispatchEvent({ type: "click" });
  assert.equal(view.count, 1);
  assert.match(root.innerHTML, /<output[^>]*>1<\/output>/);
});

test("mount gives the controller a Component and <View> renders a div", () => {
  const root = document.createElement("div");
  const controller = new PageController();
  const unmount = mount(Main, root, {}, controller);

  assert.ok(controller.view instanceof Component);
  assert.equal(controller.view.controller, controller);
  assert.equal(controller.view.node.tagName, "div"); // <View> -> <div>
  assert.equal(unmount.view, controller.view);
});

test("refresh() works on a plain object with no Component", () => {
  const controller = { user: { name: "ada" } };
  const Probe = function () {
    return h("p", null, bindTextRef(this, "user.name"));
  };
  const root = document.createElement("div");
  mount(Probe, root, {}, controller);

  controller.user.name = "hopper";
  refresh(controller);
  assert.match(root.innerHTML, />hopper</);
});

test("mount returns an unmount that clears the rendered nodes", () => {
  const root = document.createElement("div");
  const unmount = mount(Main, root, {}, new PageController());
  assert.notEqual(root.innerHTML, "");
  unmount();
  assert.equal(root.innerHTML, "");
});

test("props are one-shot initializers passed to the component", () => {
  let seen;
  const Probe = function (props) {
    seen = props;
    return h("p", null, "ok");
  };
  mount(Probe, document.createElement("div"), { title: "hi" });
  assert.equal(seen.title, "hi");
});

test("nested components bind their outlets to the same controller", () => {
  const Child = function () {
    return h("span", { ref: (el) => (this.badge = el) }, "child");
  };
  const Parent = function () {
    return h("div", { ref: (el) => (this.root = el) }, h(Child, null));
  };

  const controller = {};
  mount(Parent, document.createElement("div"), {}, controller);
  assert.equal(controller.root.tagName, "div");
  assert.equal(controller.badge.tagName, "span");
});

test("an outlet on a component hands over the component, not its element", () => {
  // What a controller has to say to a control — `enabled`, `text` — belongs to
  // the component. On a DOM element the node is the thing, and still is.
  const controller = {};
  const Mib = function () {
    return h(
      "div",
      { ref: (el) => (this.box = el) },
      h(CounterView, { ref: (v) => (this.counter = v) }),
    );
  };

  mount(Mib, document.createElement("div"), {}, controller);

  assert.equal(
    controller.box.tagName,
    "div",
    "an element outlet is still the node",
  );
  assert.ok(
    controller.counter instanceof Component,
    "a component outlet is the component",
  );
  assert.equal(controller.counter.count, 0);

  // Which is what makes driving it from the controller work at all.
  controller.counter.count = 3;
  assert.match(controller.box.innerHTML, /<output[^>]*>3<\/output>/);
});

test("a redraw points the outlet at the component that survived it", () => {
  const controller = {};

  class Host extends Component {
    constructor() {
      super();
      this.label = "before";
    }

    draw() {
      return h(
        "div",
        null,
        this.label,
        h(CounterView, { ref: (v) => (controller.counter = v) }),
      );
    }
  }

  const host = mount(Host, document.createElement("div"), {}).view;
  const first = controller.counter;

  host.label = "after";
  assert.equal(controller.counter, first, "the same component, still in hand");
});

// --- MosaicApplication -----------------------------------------------------

class AppController {
  constructor(start = 0) {
    this.count = start;
    this.title = "Mosaic";
  }

  get status() {
    return this.count >= 3 ? "high" : "";
  }

  increment() {
    this.count += 1;
    this.view.needsDisplay();
  }

  decrement() {
    this.count -= 1;
    this.view.needsDisplay();
  }
}

// The compiled entry registers its interface at import time. Standing in for that
// here is what lets these tests mount the way an application does — with
// nothing named and nothing fetched.
MosaicApplication.registerMib(Main);

test("MosaicApplication mounts the interface the compiled entry registered", async () => {
  const app = new MosaicApplication({ controller: { title: "Mosaic" } });

  assert.match(
    document.body.innerHTML,
    /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/,
  );
  document.body.textContent = "";
});

test("mounting is synchronous — the DOM is there before ready is awaited", () => {
  // Nothing is loaded, so there is nothing to wait for: the view exists as
  // soon as the constructor returns.
  const app = new MosaicApplication({ controller: { title: "Now" } });

  assert.match(document.body.innerHTML, /<h1[^>]*>Now<\/h1>/);
  assert.ok(app.view instanceof Component);
  app.unmount();
  document.body.textContent = "";
});

test("with no registered interface and no component, it says so", () => {
  const mib = MosaicApplication.mainMib;
  MosaicApplication.mainMib = null;
  try {
    assert.throws(
      () => new MosaicApplication({ controller: {} }),
      /no root component to mount/,
    );
  } finally {
    MosaicApplication.mainMib = mib;
  }
  document.body.textContent = "";
});

test("MosaicApplication mounts into the element named by the id prop", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app");
  document.body.appendChild(host);

  const app = new MosaicApplication({
    id: "app",
    controller: { title: "x" },
  });
  assert.equal(app.target, host);
  assert.match(host.innerHTML, /^<div class="app[^"]*"/);
  assert.equal(document.body.childNodes.length, 1);
  document.body.textContent = "";
});

test("component mounts something other than the registered interface", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app2");
  document.body.appendChild(host);

  const controller = { title: "Explicit" };
  const app = new MosaicApplication({
    id: "app2",
    component: Main,
    controller,
  });

  assert.ok(app.view instanceof Component);
  assert.match(host.innerHTML, /<h1[^>]*>Explicit<\/h1>/);
  assert.ok(controller.view instanceof Component);
  document.body.textContent = "";
});

test("a scope belongs to a file", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "scopes");
  document.body.appendChild(host);
  new MosaicApplication({
    id: "scopes",
    component: Main,
    controller: { title: "x" },
  });

  const mib = host.childNodes[0];
  const counter = host.querySelectorAll("output")[0];
  // The compiler appends the scope class last, which is how a test picks it
  // out now that it is a bare hash with nothing to recognise it by.
  const scopeOf = (el) =>
    (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;

  // A scope belongs to a file, and every component is one: the interface, the
  // counter it hosts and the buttons the counter draws are three modules, so
  // no two of them share a scope. What styles an element is the file it was
  // written in — there is no other rule to know.
  assert.ok(scopeOf(mib), "mib element is scoped");
  assert.ok(scopeOf(counter), "the counter's markup is scoped");
  assert.notEqual(
    scopeOf(counter),
    scopeOf(mib),
    "another module, another scope",
  );

  const button = host.querySelectorAll("button")[0];
  assert.notEqual(scopeOf(button), scopeOf(mib), "and another");
  assert.notEqual(scopeOf(button), scopeOf(counter), "and another");
  document.body.textContent = "";
});

test("MosaicApplication accepts a component directly, skipping the load", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app3");
  document.body.appendChild(host);

  const Inline = function () {
    return h("p", null, "inline");
  };
  const app = new MosaicApplication({ id: "app3", component: Inline });
  assert.match(app.target.innerHTML, /inline/);
  document.body.textContent = "";
});

test("a missing id reports a clear error", () => {
  assert.throws(
    () => new MosaicApplication({ id: "nope" }),
    /no element with id "nope"/,
  );
  document.body.textContent = "";
});

// --- drawn components (a Component subclass with draw(), not a .ib.xml file) ---

test("a Component subclass draws itself through mount()", () => {
  const root = document.createElement("div");
  const unmount = mount(CounterView, root, {});

  assert.match(root.innerHTML, /^<div class="counter[^"]*"/);
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>0<\/output>/);
  assert.ok(unmount.view instanceof Component);
});

test("needsDisplay() re-runs draw() and updates the drawing", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, { limit: "3" }).view;
  const first = root.childNodes[0];

  const [minus, plus] = root.querySelectorAll("button");
  plus.dispatchEvent({ type: "click" });
  assert.equal(view.count, 1);
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>1<\/output>/);

  // The class flips through a JS conditional in draw(), not a binding.
  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });
  assert.match(
    root.innerHTML,
    /<output class="value high[^"]*"[^>]*>3<\/output>/,
  );

  minus.dispatchEvent({ type: "click" });
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>2<\/output>/);

  // Patched in place: the root node is the same one, not a replacement.
  assert.equal(root.childNodes[0], first);
  assert.equal(root.childNodes.length, 1);
});

test("a drawn view reads props from the markup that rendered it", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, { limit: "1" }).view;
  assert.equal(view.limit, 1);

  root.querySelectorAll("button")[1].dispatchEvent({ type: "click" });
  assert.match(root.innerHTML, /class="value high[^"]*"/);
});

test("a .ib.xml interface renders a drawn view as a child component", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "composed");
  document.body.appendChild(host);

  // counter/main.ib.xml contains <Counter limit="3"/>; the compiler emitted its
  // import, resolved to wherever Counter compiled.
  const app = new MosaicApplication({
    id: "composed",
    component: Main,
    controller: { title: "Mosaic" },
  });

  assert.match(host.innerHTML, /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/);
  assert.match(host.innerHTML, /<div class="counter[^"]*"/);
  assert.match(host.innerHTML, /<output class="value[^"]*"[^>]*>0<\/output>/);

  // The drawn child redraws itself without touching the interface around it.
  host.querySelectorAll("button")[1].dispatchEvent({ type: "click" });
  assert.match(host.innerHTML, /<output class="value[^"]*"[^>]*>1<\/output>/);
  assert.match(host.innerHTML, /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/);
  document.body.textContent = "";
});

// --- the bundle ------------------------------------------------------------

test("the bundle is one self-contained module", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "bundled");
  document.body.appendChild(host);

  // build/app.js is Bun's bundle of the bootstrap — it mounts on import and
  // reaches nothing outside itself.
  const bundle = await readFile(
    new URL("../examples/Counter_component/build/app.js", import.meta.url),
    "utf8",
  );
  assert.equal(bundle.match(/^import /gm), null, "no imports left to resolve");

  // Nor anything fetched once it is running: everything the application mounts
  // is baked in, so the bundle is the whole of what ships.
  assert.equal(
    bundle.match(/\bimport\s*\(/g),
    null,
    "nothing loaded at run time",
  );

  const app = new MosaicApplication({
    id: "bundled",
    component: Main,
    controller: { title: "Bundled" },
  });

  // Everything came from one file: the interface and the drawn child it renders.
  assert.match(host.innerHTML, /<h1 class="title[^"]*"[^>]*>Bundled<\/h1>/);
  assert.match(host.innerHTML, /<div class="counter[^"]*"/);

  // The shim understands simple selectors only; the interface's buttons are the
  // drawn counter's.
  host.querySelectorAll("button")[1].dispatchEvent({ type: "click" });
  assert.match(host.innerHTML, /<output class="value[^"]*"[^>]*>1<\/output>/);
  document.body.textContent = "";
});

// --- diffing redraw --------------------------------------------------------

test("needsDisplay() patches nodes instead of rebuilding them", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, { limit: "3" }).view;

  const before = root.childNodes[0];
  const output = root.querySelectorAll("output")[0];
  const [, plus] = root.querySelectorAll("button");

  plus.dispatchEvent({ type: "click" });

  // Same nodes, updated in place — the root and the button are not replaced.
  assert.equal(root.childNodes[0], before, "root reused");
  assert.equal(root.querySelectorAll("output")[0], output, "output reused");
  assert.equal(root.querySelectorAll("button")[1], plus, "button reused");
  assert.equal(output.textContent, "1");
  assert.equal(view.count, 1);
});

test("a patched element updates only the attributes that changed", () => {
  const root = document.createElement("div");
  mount(CounterView, root, { limit: "2" });
  const output = root.querySelectorAll("output")[0];
  assert.equal(output.getAttribute("class"), `value ${COUNTER_SCOPE}`);

  const plus = root.querySelectorAll("button")[1];
  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });

  assert.equal(output.getAttribute("class"), `value high ${COUNTER_SCOPE}`);
  assert.equal(
    root.querySelectorAll("output")[0],
    output,
    "still the same node",
  );
});

test("handlers are replaced, not stacked, across redraws", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;
  const plus = root.querySelectorAll("button")[1];

  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });
  plus.dispatchEvent({ type: "click" });

  // One increment per click: a stale listener would double-count.
  assert.equal(view.count, 3);
});

test("a component's scope covers its own elements, not a child component's", () => {
  const root = document.createElement("div");
  mount(CounterView, root, {});

  // The compiler appends the scope class last, which is how a test picks it
  // out now that it is a bare hash with nothing to recognise it by.
  const scopeOf = (el) =>
    (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;

  const own = scopeOf(root.childNodes[0]);
  assert.ok(own, "root carries a scope attribute");
  assert.equal(
    scopeOf(root.querySelectorAll("output")[0]),
    own,
    "own element shares it",
  );

  // <Button/> is another module: it styles its own markup.
  const button = root.querySelectorAll("button")[0];
  assert.ok(scopeOf(button), "the child component is scoped too");
  assert.notEqual(scopeOf(button), own, "but with its own hash");

  // ...and the scope survives a redraw.
  button.dispatchEvent({ type: "click" });
  assert.equal(scopeOf(root.querySelectorAll("output")[0]), own);
});

// --- convention-based event handlers ---------------------------------------

test("a method named after an event is bound automatically", () => {
  const seen = [];

  class Widget extends Component {
    pointerDown(event) {
      seen.push(["pointerDown", event.type]);
    }

    keyUp() {
      seen.push(["keyUp"]);
    }

    draw() {
      return h("button", null, "x");
    }
  }

  const root = document.createElement("div");
  mount(Widget, root, {});
  const el = root.childNodes[0];

  el.dispatchEvent({ type: "pointerdown" });
  el.dispatchEvent({ type: "keyup" });
  assert.deepEqual(seen, [["pointerDown", "pointerdown"], ["keyUp"]]);
});

test("events with no handler are not listened for", () => {
  class Widget extends Component {
    click() {}

    draw() {
      return h("button", null, "x");
    }
  }

  const root = document.createElement("div");
  mount(Widget, root, {});
  const el = root.childNodes[0];

  assert.deepEqual([...el.listeners.keys()], ["click"]);
});

test("handlers are not stacked when a redraw reuses the node", () => {
  let clicks = 0;

  class Widget extends Component {
    constructor() {
      super();
      this.label = "a";
    }

    click() {
      clicks += 1;
      this.label = `a${clicks}`;
      this.needsDisplay();
    }

    draw() {
      return h("button", null, this.label);
    }
  }

  const root = document.createElement("div");
  mount(Widget, root, {});
  const el = root.childNodes[0];

  el.dispatchEvent({ type: "click" });
  el.dispatchEvent({ type: "click" });
  el.dispatchEvent({ type: "click" });
  assert.equal(clicks, 3, "one call per click");
  assert.equal(el.listeners.get("click").length, 1, "one listener");
});

test("a handler can be replaced after mounting", () => {
  let which = "";

  class Widget extends Component {
    click() {
      which = "original";
    }

    draw() {
      return h("button", null, "x");
    }
  }

  const root = document.createElement("div");
  const view = mount(Widget, root, {}).view;
  view.click = () => (which = "replacement");

  root.childNodes[0].dispatchEvent({ type: "click" });
  assert.equal(which, "replacement");
});

test("action still works for actions that are not event names", () => {
  // Counter.js binds action="increment" — a method name of its own choosing.
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;
  root.querySelectorAll("button")[1].dispatchEvent({ type: "click" });
  assert.equal(view.count, 1);
});

// --- cleanup ---------------------------------------------------------------

test("unmount removes the listeners a component attached", () => {
  let clicks = 0;

  class Widget extends Component {
    click() {
      clicks += 1;
    }

    draw() {
      return h("button", null, "x");
    }
  }

  const root = document.createElement("div");
  const unmount = mount(Widget, root, {});
  const el = root.childNodes[0];

  el.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);

  unmount();
  el.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1, "no longer listening");
  assert.equal(el.listeners.get("click").length, 0);
  assert.equal(root.innerHTML, "", "and the nodes are gone");
});

test("a child component removed by a redraw is released", () => {
  let childClicks = 0;
  let detached = 0;

  class Child extends Component {
    click() {
      childClicks += 1;
    }

    detached() {
      detached += 1;
    }

    draw() {
      return h("button", null, "child");
    }
  }

  class Parent extends Component {
    constructor() {
      super();
      this.showChild = true;
    }

    draw() {
      return h("div", null, this.showChild ? h(Child, null) : null);
    }
  }

  const root = document.createElement("div");
  const parent = mount(Parent, root, {}).view;
  const childEl = root.querySelectorAll("button")[0];

  childEl.dispatchEvent({ type: "click" });
  assert.equal(childClicks, 1);

  parent.showChild = false;
  parent.needsDisplay();

  assert.equal(root.querySelectorAll("button").length, 0, "child left the DOM");
  assert.equal(detached, 1, "detached() ran");
  childEl.dispatchEvent({ type: "click" });
  assert.equal(childClicks, 1, "listener was removed with it");
});

test("children dropped from a list are released", () => {
  const detached = [];

  class Row extends Component {
    detached() {
      detached.push(this.props.label);
    }

    draw() {
      return h("li", null, this.props.label);
    }
  }

  class List extends Component {
    constructor() {
      super();
      this.items = ["a", "b", "c"];
    }

    draw() {
      return h(
        "ul",
        null,
        this.items.map((label) => h(Row, { label })),
      );
    }
  }

  const root = document.createElement("div");
  const list = mount(List, root, {}).view;
  assert.equal(root.querySelectorAll("li").length, 3);

  list.items = ["a"];
  list.needsDisplay();

  assert.equal(root.querySelectorAll("li").length, 1);
  assert.deepEqual(detached, ["b", "c"]);
});

test("destroy() releases nested components too", () => {
  const detached = [];

  class Inner extends Component {
    detached() {
      detached.push("inner");
    }

    draw() {
      return h("span", null, "i");
    }
  }

  class Outer extends Component {
    detached() {
      detached.push("outer");
    }

    draw() {
      return h("div", null, h(Inner, null));
    }
  }

  const root = document.createElement("div");
  const unmount = mount(Outer, root, {});
  unmount();

  assert.deepEqual(detached.sort(), ["inner", "outer"]);
});

// --- lifecycle hooks -------------------------------------------------------

test("attached() runs once when a component enters the DOM", () => {
  const events = [];

  class Widget extends Component {
    attached() {
      events.push([
        "attached",
        this.node.tagName,
        this.node.parentNode !== null,
      ]);
    }

    detached() {
      events.push(["detached"]);
    }

    draw() {
      return h("p", null, "x");
    }
  }

  const root = document.createElement("div");
  const unmount = mount(Widget, root, {});
  assert.deepEqual(
    events,
    [["attached", "p", true]],
    "node is in place when it runs",
  );

  unmount.view.needsDisplay();
  unmount.view.needsDisplay();
  assert.equal(events.length, 1, "a redraw is not a re-attach");

  unmount();
  assert.deepEqual(events[1], ["detached"]);
});

test("a child added by a redraw is attached, and only it", () => {
  const attached = [];

  class Row extends Component {
    attached() {
      attached.push(this.props.label);
    }

    draw() {
      return h("li", null, this.props.label);
    }
  }

  class List extends Component {
    constructor() {
      super();
      this.items = ["a"];
    }

    draw() {
      return h(
        "ul",
        null,
        this.items.map((label) => h(Row, { label })),
      );
    }
  }

  const root = document.createElement("div");
  const list = mount(List, root, {}).view;
  assert.deepEqual(attached, ["a"]);

  list.items = ["a", "b"];
  list.needsDisplay();
  assert.deepEqual(attached, ["a", "b"], "only the new row was attached");
});

test("children are attached before their parent", () => {
  const order = [];

  class Inner extends Component {
    attached() {
      order.push("inner");
    }

    draw() {
      return h("span", null, "i");
    }
  }

  class Outer extends Component {
    attached() {
      order.push("outer");
    }

    draw() {
      return h("div", null, h(Inner, null));
    }
  }

  mount(Outer, document.createElement("div"), {});
  assert.deepEqual(order, ["inner", "outer"]);
});

test("overriding the hooks cannot break event binding", () => {
  // Neither hook calls super; the runtime binds and unbinds on its own.
  let clicks = 0;

  class Widget extends Component {
    attached() {
      /* no super */
    }

    detached() {
      /* no super */
    }

    click() {
      clicks += 1;
    }

    draw() {
      return h("button", null, "x");
    }
  }

  const root = document.createElement("div");
  const unmount = mount(Widget, root, {});
  const el = root.childNodes[0];

  el.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1, "bound despite the override");

  unmount();
  el.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1, "unbound despite the override");
});

test("isAttached tracks the component's state", () => {
  class Widget extends Component {
    draw() {
      return h("p", null, "x");
    }
  }

  const root = document.createElement("div");
  const unmount = mount(Widget, root, {});
  assert.equal(unmount.view.isAttached, true);

  unmount();
  assert.equal(unmount.view.isAttached, false);
});

// --- the same interface, drawn by one component ---------------------------------

// Counter_main: the interface and the controller that drives every part of it.
// (`AppController` above is a local stand-in used by the mount tests.)
const { default: ExampleController } =
  await import("../examples/Counter_main/build/AppController.js");
const { default: AppPage } =
  await import("../examples/Counter_main/build/main.ib.js");

test("AppController drives the interface without a Counter component", () => {
  const root = document.createElement("div");
  const controller = new ExampleController({ title: "Counter App" });
  mount(AppPage, root, {}, controller);

  assert.match(root.innerHTML, /^<div class="app[^"]*"/);
  assert.match(root.innerHTML, /<h1 class="title[^"]*"[^>]*>Counter App<\/h1>/);
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>0<\/output>/);
  // Two Buttons, and no counter component between them and the interface.
  assert.equal(root.querySelectorAll("button").length, 2);

  const [minus, plus] = root.querySelectorAll("button");
  plus.dispatchEvent({ type: "click" });
  assert.equal(
    controller.count,
    1,
    "the Button's action ran a method on the controller",
  );
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>1<\/output>/);

  minus.dispatchEvent({ type: "click" });
  assert.equal(controller.count, 0);
});

test("its buttons are scoped to Button, its own markup to itself", () => {
  const root = document.createElement("div");
  mount(AppPage, root, {}, new ExampleController());

  // The compiler appends the scope class last, which is how a test picks it
  // out now that it is a bare hash with nothing to recognise it by.
  const scopeOf = (el) =>
    (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;
  const mib = scopeOf(root.childNodes[0]);
  const button = scopeOf(root.querySelectorAll("button")[0]);

  assert.ok(mib && button);
  assert.notEqual(mib, button, "Button styles its own markup");
  assert.equal(scopeOf(root.querySelectorAll("output")[0]), mib);
});

test("the controller and a bare object render the same markup", () => {
  const a = document.createElement("div");
  mount(AppPage, a, {}, new ExampleController({ title: "Mosaic" }));

  const b = document.createElement("div");
  mount(AppPage, b, {}, { title: "Mosaic", count: 0, status: "" });

  // Both mount the same interface, so the scope is identical either way — the
  // comparison is of what the two controllers made of it.
  const shape = (html) => html.replace(/<p class="hint[^"]*">.*?<\/p>/, "");
  assert.equal(shape(a.innerHTML), shape(b.innerHTML));
});

// --- implicit observability ------------------------------------------------
//
// Binding to a property in markup is what makes it observable: assigning to it
// updates the DOM, with nothing in the controller saying so.

test("assigning to a bound property updates the DOM", () => {
  const root = document.createElement("div");
  const controller = new PageController("Mosaic");
  mount(Main, root, {}, controller);

  controller.title = "Changed";
  assert.match(root.innerHTML, /<h1[^>]*>Changed<\/h1>/);
});

test("the update is synchronous, like needsDisplay()", () => {
  const root = document.createElement("div");
  const controller = new PageController("a");
  mount(Main, root, {}, controller);

  // Assign and read the DOM on the next line, with nothing awaited.
  controller.title = "b";
  assert.match(root.innerHTML, /<h1[^>]*>b<\/h1>/);
  controller.title = "c";
  assert.match(root.innerHTML, /<h1[^>]*>c<\/h1>/);
});

test("a property nobody binds to stays an ordinary one", () => {
  const root = document.createElement("div");
  const controller = new PageController("Mosaic");
  mount(Main, root, {}, controller);

  controller.untouched = 1;
  const descriptor = Object.getOwnPropertyDescriptor(controller, "untouched");
  assert.ok("value" in descriptor, "no accessor was installed");

  // A bound one is wrapped, and still reads back as what was assigned.
  const bound = Object.getOwnPropertyDescriptor(controller, "title");
  assert.equal(typeof bound.get, "function");
  controller.title = "read back";
  assert.equal(controller.title, "read back");
});

// --- drawn views observe what they read ------------------------------------

test("a drawn view redraws when a property it read changes", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;
  const out = () => root.querySelectorAll("output")[0];

  assert.equal(out().textContent, "0");
  view.count = 4; // no needsDisplay
  assert.equal(out().textContent, "4");
});

test("a property read through a getter is observed too", () => {
  // `status` derives from `count`; recording the reads draw() makes catches
  // the `count` inside it, so the class follows.
  const root = document.createElement("div");
  const view = mount(CounterView, root, { limit: "2" }).view;

  view.count = 2;
  assert.match(
    root.querySelectorAll("output")[0].getAttribute("class"),
    /high/,
  );
});

test("a property draw() never read is not observed", () => {
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;

  view.unused = 1;
  const descriptor = Object.getOwnPropertyDescriptor(view, "unused");
  assert.ok("value" in descriptor, "no accessor was installed");
});

test("a method is not mistaken for state", () => {
  // draw() calls `this.status`, and a handler names `this.increment` — one is
  // state, the other is not.
  const root = document.createElement("div");
  const view = mount(CounterView, root, {}).view;

  const increment = Object.getOwnPropertyDescriptor(view, "increment");
  assert.equal(increment, undefined, "methods stay on the prototype");
});

test("a control fires as itself, not as the proxy its drawing ran against", () => {
  // A drawing runs against a proxy so its reads can be recorded. A handler set
  // up while drawing closes over that proxy, so anything handing itself
  // outward has to unwrap first — `this.self` is what does it.
  let handed;

  class Host extends Component {
    draw() {
      const fire = () => (handed = this.self);
      return h("button", { onclick: fire }, "go");
    }
  }

  const root = document.createElement("div");
  const view = mount(Host, root, {}).view;
  root.childNodes[0].dispatchEvent({ type: "click" });

  assert.equal(handed, view, "the component, not a wrapper around it");
  assert.equal(view.self, view, "and unwrapping outside a draw is a no-op");
});

test("what is assigned to a component before it is on the interface is still drawn", () => {
  // An `outlet` hands a component over while the tree is still being built, so
  // a controller that says something to it straight away is talking to a view
  // whose nodes have nowhere to be yet. The redraw is remembered and done when
  // they land — dropping it loses whatever was assigned.
  class Counter extends Component {
    constructor() {
      super();
      this.count = 0;
    }

    draw() {
      return h("p", {}, String(this.count));
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);

  mount(
    function Mib() {
      return h("div", {}, h(Counter, { ref: (view) => (view.count = 7) }));
    },
    host,
    {},
    {},
  );

  assert.equal(host.textContent, "7");
});

// --- keyed children ----------------------------------------------------------
//
// Children are matched by position unless they carry a `key`. What keys are for
// is a list that loses one from the middle: matched by position, every child
// after the gone one would be patched against its neighbour's vnode and, since
// a differing key makes two vnodes different kinds, torn down and built again.
// A child that is a component would come back as a new instance, and whatever
// it was holding would go with the old one.

/** A component that counts how many of it have ever been built. */
class Counted extends Component {
  static built = 0;

  constructor(controller) {
    super(controller);
    this.serial = ++Counted.built;
  }

  draw() {
    return h("li", {}, String(this.props.label ?? ""));
  }
}

/** A list of keyed rows, drawn from whatever `rows` the controller holds. */
class KeyedList extends Component {
  constructor() {
    super();
    this.rows = [];
  }

  draw() {
    return h(
      "ul",
      {},
      this.rows.map((row) => h(Counted, { key: row, label: row })),
    );
  }
}

/** Mount one, and give back the ways of asking what it did. */
function keyedList(rows) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = mount(KeyedList, host, {}).view;
  view.rows = rows;
  view.needsDisplay();

  const list = () => host.childNodes[0];
  return {
    view,
    labels: () => [...list().childNodes].map((n) => n.textContent),
    // The instance behind each row, which is what a rebuild would replace.
    instances: () => [...list().childNodes].map((n) => n.__ibView),
    nodes: () => [...list().childNodes],
  };
}

test("a keyed row taken from the middle leaves the rest as they were", () => {
  const list = keyedList(["a", "b", "c"]);
  const before = list.instances();
  const nodes = list.nodes();

  list.view.rows = ["a", "c"];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), ["a", "c"]);
  // The same components, and the same DOM: neither was rebuilt.
  assert.deepEqual(list.instances(), [before[0], before[2]]);
  assert.deepEqual(list.nodes(), [nodes[0], nodes[2]]);
});

test("a keyed row taken from the front leaves the rest as they were", () => {
  const list = keyedList(["a", "b", "c"]);
  const before = list.instances();

  list.view.rows = ["b", "c"];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), ["b", "c"]);
  assert.deepEqual(list.instances(), [before[1], before[2]]);
});

test("reordering keyed rows moves them rather than rebuilding them", () => {
  const list = keyedList(["a", "b", "c"]);
  const before = list.instances();

  list.view.rows = ["c", "a", "b"];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), ["c", "a", "b"]);
  assert.deepEqual(list.instances(), [before[2], before[0], before[1]]);
});

test("a keyed row added to the middle builds only itself", () => {
  const list = keyedList(["a", "c"]);
  const before = list.instances();
  const built = Counted.built;

  list.view.rows = ["a", "b", "c"];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), ["a", "b", "c"]);
  assert.equal(Counted.built, built + 1);
  assert.equal(list.instances()[0], before[0]);
  assert.equal(list.instances()[2], before[1]);
});

test("emptying a keyed list takes every row off the interface", () => {
  const list = keyedList(["a", "b", "c"]);

  list.view.rows = [];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), []);
});

test("children with no key are still matched by where they sit", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);

  class Mixed extends Component {
    constructor() {
      super();
      this.rows = ["a", "b"];
    }

    // A heading with no key beside rows that have one — the ordinary shape of
    // a list with something above it.
    draw() {
      return h(
        "div",
        {},
        h("h2", {}, "Heading"),
        this.rows.map((row) => h("span", { key: row }, row)),
      );
    }
  }

  const view = mount(Mixed, host, {}).view;
  const texts = () =>
    [...host.childNodes[0].childNodes].map((n) => n.textContent);
  assert.deepEqual(texts(), ["Heading", "a", "b"]);

  view.rows = ["b"];
  view.needsDisplay();
  assert.deepEqual(texts(), ["Heading", "b"]);
});

// --- fragments among siblings ------------------------------------------------

test("a fragment beside a blank sibling redraws without reaching for the wrong node", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);

  // The shape a snackbar draws: an icon that may be absent, then content that
  // is a fragment. A fragment left whole would be one child standing for the
  // two nodes it drew, so the patch would line the fragment up against the
  // node before it — a comment, or a text node — and try to append there.
  class Bar extends Component {
    constructor() {
      super();
      this.label = "one";
      this.icon = null;
    }

    draw() {
      return h(
        "div",
        {},
        this.icon,
        h(Fragment, null, h("span", {}, this.label), h("b", {}, "!")),
      );
    }
  }

  const view = mount(Bar, host, {}).view;
  const drawn = () =>
    [...host.childNodes[0].childNodes].map((n) => n.textContent);

  assert.deepEqual(drawn(), ["one", "!"]);

  view.label = "two";
  view.needsDisplay();
  assert.deepEqual(drawn(), ["two", "!"]);
});

test("a fragment's children are levelled into the list around it", () => {
  const vnode = h(
    "div",
    {},
    h("i", {}, "before"),
    h(Fragment, null, h("span", {}, "a"), h("span", {}, "b")),
    h("i", {}, "after"),
  );

  // Four children, not three: what the fragment holds belongs to the div, so
  // the list has one entry per node the div will end up with.
  assert.deepEqual(
    vnode.children.map((c) => c.type),
    ["i", "span", "span", "i"],
  );
});

// --- composing views ---------------------------------------------------------
//
// A `.ib.xml` file placed as a tag is a component: it draws against a scope of its
// own, and the tag's attributes are that scope's starting state. Nothing has to
// be written as a class for it. What tells the runtime a function came from
// markup is `isMarkup`, which the compiler puts on it — a function component
// written by hand is the older, plainer thing and still draws against whoever
// placed it.

/** A compiled view, as the compiler emits one: a function, marked. */
function view(fn, controller) {
  fn.isMarkup = true;
  if (controller) fn.controller = controller;
  return fn;
}

/**
 * The same, for a file with a bound prop in it — which is what the compiler
 * marks `redraws`, and what makes the view draw itself again rather than only
 * bringing its bindings up to date.
 */
function redrawingView(fn, controller) {
  view(fn, controller);
  fn.redraws = true;
  return fn;
}

test("a composed view draws against a scope of its own", () => {
  const seen = [];
  const Child = view(function () {
    seen.push(this);
    return h("span", {}, "child");
  });
  const controller = { name: "the mib" };
  const Mib = view(function () {
    return h("div", {}, h(Child, null));
  });

  mount(Mib, document.createElement("div"), {}, controller);
  assert.notEqual(seen[0], controller, "not the controller that drew it");
  assert.equal(seen[0].name, undefined, "and it cannot see that one's state");
});

test("the tag's attributes are the view's state", () => {
  const Labelled = view(function () {
    return h("p", {}, bindTextRef(this, "label"));
  });
  const Mib = view(function () {
    return h("div", {}, h(Labelled, { label: "passed in" }));
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, {});

  assert.equal(host.childNodes[0].childNodes[0].textContent, "passed in");
});

test("a view composed twice is two views", () => {
  const Labelled = view(function () {
    return h("p", {}, bindTextRef(this, "label"));
  });
  const Mib = view(function () {
    return h(
      "div",
      {},
      h(Labelled, { label: "first" }),
      h(Labelled, { label: "second" }),
    );
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, {});

  assert.deepEqual(
    [...host.childNodes[0].childNodes].map((n) => n.textContent),
    ["first", "second"],
  );
});

test("a view with a controller of its own draws against an instance of it", () => {
  class LabelController {
    constructor() {
      this.shouted = "";
    }
    shout() {
      this.shouted = String(this.label ?? "").toUpperCase();
    }
  }

  const built = [];
  const Labelled = view(function () {
    built.push(this);
    return h("p", {}, bindTextRef(this, "label"));
  }, LabelController);

  const Mib = view(function () {
    return h("div", {}, h(Labelled, { label: "hello" }));
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, {});

  assert.ok(built[0] instanceof LabelController);
  // The props reached the controller, so its own methods can use them.
  assert.equal(built[0].label, "hello");
  built[0].shout();
  assert.equal(built[0].shouted, "HELLO");
});

test("a prop that changes reaches the view it was given to", () => {
  const Labelled = view(function () {
    return h("p", {}, bindTextRef(this, "label"));
  });

  class Mib extends Component {
    constructor() {
      super();
      this.label = "before";
    }
    draw() {
      return h("div", {}, h(Labelled, { label: this.label }));
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const { view: mib } = mount(Mib, host, {});

  const text = () => host.childNodes[0].childNodes[0].textContent;
  assert.equal(text(), "before");

  mib.label = "after";
  assert.equal(text(), "after");
});

test("a boolean attribute arrives as a boolean, as it does on a component", () => {
  const seen = [];
  const Flagged = view(function () {
    seen.push(this.shown);
    return h("p", {}, "x");
  });
  const Mib = view(function () {
    return h("div", {}, h(Flagged, { shown: "false" }));
  });

  mount(Mib, document.createElement("div"), {}, {});
  assert.equal(seen[0], false);
});

test("a function component written by hand still draws against its caller", () => {
  // Unmarked: the behaviour the framework had before views could be composed,
  // which an icon and any hand-written helper still rely on.
  const Child = function () {
    return h("span", { ref: (el) => (this.badge = el) }, "child");
  };
  const Parent = function () {
    return h("div", {}, h(Child, null));
  };

  const controller = {};
  mount(Parent, document.createElement("div"), {}, controller);
  assert.equal(controller.badge.tagName, "span");
});

test("an outlet on a composed view hands over its scope, controller or not", () => {
  class Own {}
  const WithController = view(function () {
    return h("p", {}, "a");
  }, Own);
  const Without = view(function () {
    return h("b", {}, "b");
  });

  const controller = {};
  const Mib = view(function () {
    return h(
      "div",
      {},
      h(WithController, { ref: (v) => (this.withOne = v) }),
      h(Without, { label: "given", ref: (v) => (this.without = v) }),
    );
  });

  mount(Mib, document.createElement("div"), {}, controller);
  assert.ok(controller.withOne instanceof Own);
  // A view with no class of any kind still hands over something to talk to,
  // carrying what its tag was given.
  assert.equal(controller.without.label, "given");
  assert.equal(controller.without.tagName, undefined, "not its element");
});

test("a prop set through an outlet reaches the view that holds it", () => {
  // What makes a `.ib.xml` on its own enough: no class, and the interface can still
  // say `this.card.value = 12` and see it.
  const Card = view(function () {
    return h("p", {}, bindTextRef(this, "value"));
  });
  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Card, { value: "1", ref: (v) => (this.card = v) }));
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, controller);

  const text = () => host.childNodes[0].childNodes[0].textContent;
  assert.equal(text(), "1");

  // Read it back, and set it.
  assert.equal(controller.card.value, "1");
  controller.card.value = "12";
  assert.equal(text(), "12");
  assert.equal(controller.card.value, "12");
});

// --- a composed view redraws ------------------------------------------------
//
// Saying something to a view re-runs the function the compiler made of its
// markup and patches the two trees against each other. That is what carries a
// value into a child — a Button's `text`, another view's prop — which a binding
// alone cannot do: a binding keeps this markup's own text and attributes right,
// and a component is not this markup.

/** `bindProp` as the compiler emits it for `<Child text="{label}"/>`. */
const { bindProp } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");

test("a value reaches a child component's prop, not just a text node", () => {
  const Inner = view(function () {
    return h("em", {}, bindTextRef(this, "label"));
  });

  const Outer = redrawingView(function () {
    return h(
      "div",
      {},
      h("p", {}, bindTextRef(this, "label")),
      h(Inner, { label: bindProp(this, [{ path: "label" }]) }),
    );
  });

  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Outer, { ref: (v) => (this.outer = v) }));
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, controller);

  const text = () => host.querySelector("p").textContent;
  const inner = () => host.querySelector("em").textContent;

  controller.outer.label = "Click It";
  assert.equal(text(), "Click It", "this markup's own text");
  assert.equal(inner(), "Click It", "and the view it was handed to");
});

test("redrawing patches: the nodes that stay are the same nodes", () => {
  const Child = view(function () {
    return h("em", {}, bindTextRef(this, "label"));
  });
  const Outer = redrawingView(function () {
    return h(
      "div",
      {},
      h("p", {}, "unchanged"),
      h(Child, { label: bindProp(this, [{ path: "label" }]) }),
    );
  });
  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Outer, { ref: (v) => (this.outer = v) }));
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Mib, host, {}, controller);

  const before = {
    root: host.querySelector("div div"),
    para: host.querySelector("p"),
    em: host.querySelector("em"),
  };

  controller.outer.label = "again";

  assert.equal(host.querySelector("div div"), before.root, "the view's root");
  assert.equal(host.querySelector("p"), before.para, "a node it did not touch");
  assert.equal(host.querySelector("em"), before.em, "and the one it did");
});

test("a lone bound prop is the value itself, not a string of it", () => {
  const seen = [];
  const Child = view(function (props) {
    seen.push(props.count);
    return h("em", {}, "x");
  });
  const Outer = redrawingView(function () {
    return h("div", {}, h(Child, { count: bindProp(this, [{ path: "n" }]) }));
  });
  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Outer, { ref: (v) => (this.outer = v) }));
  });

  mount(Mib, document.createElement("div"), {}, controller);
  controller.outer.n = 12;
  assert.equal(seen[seen.length - 1], 12, "a number stays a number");
});

test("text around a bound prop makes it a string", () => {
  const seen = [];
  const Child = view(function (props) {
    seen.push(props.title);
    return h("em", {}, "x");
  });
  const Outer = redrawingView(function () {
    return h(
      "div",
      {},
      h(Child, { title: bindProp(this, ["hello ", { path: "name" }]) }),
    );
  });
  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Outer, { ref: (v) => (this.outer = v) }));
  });

  mount(Mib, document.createElement("div"), {}, controller);
  controller.outer.name = "Ada";
  assert.equal(seen[seen.length - 1], "hello Ada");
});

test("a view redrawn many times registers one notifier, not one per draw", () => {
  const Child = view(function () {
    return h("em", {}, "x");
  });
  const Outer = redrawingView(function () {
    return h("div", {}, h(Child, { label: bindProp(this, [{ path: "n" }]) }));
  });
  const controller = {};
  const Mib = view(function () {
    return h("div", {}, h(Outer, { ref: (v) => (this.outer = v) }));
  });

  mount(Mib, document.createElement("div"), {}, controller);
  for (let i = 0; i < 50; i++) controller.outer.n = i;
  // Nothing to assert but that it is still standing and still right: a
  // notifier per draw would have grown a set of 50 and run 50 redraws for the
  // last assignment.
  assert.equal(controller.outer.n, 49);
});

test("a controller an interface was mounted with keeps its binding pass", () => {
  // It has no view function behind it — the interface's markup is not its own — so
  // there is nothing to re-run, and its bindings are pushed to the DOM as they
  // always were.
  const controller = { user: { name: "ada" } };
  const Probe = function () {
    return h("p", null, bindTextRef(this, "user.name"));
  };
  const root = document.createElement("div");
  mount(Probe, root, {}, controller);

  controller.user = { name: "grace" };
  assert.match(root.innerHTML, />grace</);
});

test("a keyed row already in order is left where it is, not moved", () => {
  // Placing every child in turn would move all of them: drop the first and the
  // second has to go to the front, and from there each one no longer follows
  // what it followed, so each is taken out and put back. A window scrolling by
  // one row would move every row in it. Order is what matters, not position.
  const list = keyedList(["a", "b", "c", "d", "e"]);
  const nodes = list.nodes();

  let moved = 0;
  const parent = nodes[0].parentNode;
  const insert = parent.insertBefore.bind(parent);
  parent.insertBefore = (node, before) => {
    moved++;
    return insert(node, before);
  };

  // A window moving on: one leaves the front, one arrives at the back.
  list.view.rows = ["b", "c", "d", "e", "f"];
  list.view.needsDisplay();
  parent.insertBefore = insert;

  assert.deepEqual(list.labels(), ["b", "c", "d", "e", "f"]);
  assert.equal(moved, 1, "only the row that came into view was placed");
  for (let i = 0; i < 4; i++) {
    assert.ok(list.nodes()[i] === nodes[i + 1], `row ${i} is the node it was`);
  }
});

test("but one that has come back past another is moved", () => {
  const list = keyedList(["a", "b", "c"]);
  const before = list.instances();

  list.view.rows = ["c", "a", "b"];
  list.view.needsDisplay();

  assert.deepEqual(list.labels(), ["c", "a", "b"]);
  // Moved, not rebuilt: the instances are the ones that were there.
  const now = list.instances();
  assert.ok(now[0] === before[2]);
  assert.ok(now[1] === before[0]);
  assert.ok(now[2] === before[1]);
});

test("handing back the same vnode leaves what it drew alone", () => {
  // A caller that hands back the vnode it was given is saying nothing here
  // changed, and is answered by being left alone — which is what lets a
  // progressive list keep the drawing of every row still on screen and pay
  // nothing for the ones it did not touch. Cheapness is not what this checks,
  // since a walk that finds no difference makes no difference either; what it
  // checks is that reusing a drawing is safe to do.
  class Cached extends Component {
    constructor() {
      super();
      this.held = null;
      this.label = "one";
    }

    draw() {
      // The same vnode object every time, whatever `label` now says.
      if (!this.held) this.held = h("p", { title: this.label }, this.label);
      return h("div", {}, this.held);
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(Cached, host, {}).view;
  const drawn = host.childNodes[0].childNodes[0];

  assert.equal(drawn.textContent, "one");

  view.label = "two";
  view.needsDisplay();

  assert.ok(
    host.childNodes[0].childNodes[0] === drawn,
    "the node is the one that was there",
  );
  assert.equal(drawn.textContent, "one", "and it was not written to");
  assert.equal(drawn.getAttribute("title"), "one");
});

// --- styleName on a component ------------------------------------------------
//
// `styleName` on a component means "and wear this too". The component decides
// what it is; the tag that placed it may still have something to add, and says
// it the way it would about an element of its own.

/** A component that draws a class list of its own, and counts its drawings. */
class Faced extends Component {
  constructor() {
    super();
    this.label = "one";
  }

  draw() {
    return h("div", { class: ["v-Faced", "own"] }, this.label);
  }
}

const classesOn = (el) =>
  (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

test("a component wears the class the tag asked it to", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Faced, host, { styleName: "wide" });

  const el = host.childNodes[0];
  assert.deepEqual(classesOn(el), ["v-Faced", "own", "wide"]);
});

test("and it survives the component drawing itself again", () => {
  // Put on the drawing rather than on the node: written onto the element it
  // would be patched off the first time the component drew again, since the
  // component's own drawing never mentioned it.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = mount(Faced, host, { styleName: "wide" }).view;

  view.label = "two";
  const el = host.childNodes[0];
  assert.equal(el.textContent, "two", "it did draw again");
  assert.deepEqual(classesOn(el), ["v-Faced", "own", "wide"]);
});

test("more than one class, and none, both work", () => {
  const two = document.createElement("div");
  document.body.appendChild(two);
  mount(Faced, two, { styleName: "wide tall" });
  assert.deepEqual(classesOn(two.childNodes[0]), [
    "v-Faced",
    "own",
    "wide",
    "tall",
  ]);

  const none = document.createElement("div");
  document.body.appendChild(none);
  mount(Faced, none, {});
  assert.deepEqual(classesOn(none.childNodes[0]), ["v-Faced", "own"]);
});

test("a component whose root is another component passes it down", () => {
  // There is no element to put it on until the innermost drawing, so it is
  // carried until there is one.
  class Wrapping extends Component {
    draw() {
      return h(Faced, {});
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(Wrapping, host, { styleName: "framed" });

  assert.deepEqual(classesOn(host.childNodes[0]), ["v-Faced", "own", "framed"]);
});
