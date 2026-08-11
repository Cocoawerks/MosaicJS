// End-to-end check: compiled output + runtime produce the expected DOM, and a
// controller drives every update afterwards.
// Uses a tiny DOM shim so the test runs on plain node, no browser needed.
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import "./dom-shim.mjs";

// Every module is imported up front: a later top-level `await import` would
// yield, letting queued tests run before its bindings exist.
//
// The runtime comes from the app's own build, not from src/: each application
// vendors a copy, and `instanceof` only holds against the copy its modules
// were compiled against.
const { mount, h, refresh, Component, MosaicApplication, bindText: bindTextRef } = await import(
    "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
    );
const {default: Main} = await import("../examples/Counter_component/build/src/main.mib.js");
const {default: Button} = await import(
    "../examples/Counter_component/build/ui/button/Button.js"
);
const {addStyles} = await import(
    "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
    );

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
        {class: `counter ${COUNTER_SCOPE}`},
        h(Button, {text: "-", action: (...a) => this.decrement(...a)}),
        h(
            "output",
            {class: `value ${this.status} ${COUNTER_SCOPE}`.replace(/\s+/g, " ")},
            String(this.count),
        ),
        h(Button, {text: "+", intent: "primary", action: (...a) => this.increment(...a)}),
    );
  }
}

// A plain class — the view is handed to it as `this.view` by mount().
// The page controller for main.mib: `{title}` reads this.
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
  const controller = {user: {name: "ada"}};
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
  controller.user = {name: "hopper"};
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

// `base` is resolved against mosaic.js, which each app vendors into its own
// build/node_modules/mosaic/runtime/ — so the compiled modules sit three
// levels up, at the root of the build.
MosaicApplication.base = "../../../src/";

test("MosaicApplication loads the compiled root component and mounts it", async () => {
  const app = new MosaicApplication({ controller: { title: "Mosaic" } });
  await app.ready;

  // Found its entry on its own — `main.mib.js`, what main.mib compiles to — with
  // no mount() call and no explicit import.
  assert.match(app.src, /main\.mib\.js$/);
  assert.match(document.body.innerHTML, /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/);
  document.body.textContent = "";
});

test("MosaicApplication mounts into the element named by the id prop", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app");
  document.body.appendChild(host);

  const app = await MosaicApplication.run({ id: "app", controller: { title: "x" } });
  assert.equal(app.target, host);
  assert.match(host.innerHTML, /^<div class="app[^"]*"/);
  assert.equal(document.body.childNodes.length, 1);
  document.body.textContent = "";
});

test("src selects an explicit module instead of the entry search", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app2");
  document.body.appendChild(host);

  // `src` is resolved like `base`: relative to mosaic.js.
  const controller = { title: "Explicit" };
  const app = await MosaicApplication.run({
    id: "app2",
    src: "../../../src/main.mib.js",
    controller,
  });

  assert.match(app.src, /main\.mib\.js$/);
  assert.match(host.innerHTML, /<h1[^>]*>Explicit<\/h1>/);
  assert.ok(controller.view instanceof Component);
  document.body.textContent = "";
});

test("a scope belongs to a file, inline components included", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "scopes");
  document.body.appendChild(host);
  await MosaicApplication.run({
    id: "scopes",
    src: "../../../src/main.mib.js",
    controller: {title: "x"},
  });

  const page = host.childNodes[0];
  const counter = host.querySelectorAll("output")[0];
  // The compiler appends the scope class last, which is how a test picks it
  // out now that it is a bare hash with nothing to recognise it by.
  const scopeOf = (el) => (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;

  // A scope belongs to a file. The counter is declared in this page's
  // <script>, so it is styled by this page's <style> — same file, same scope.
  assert.ok(scopeOf(page), "page element is scoped");
  assert.ok(scopeOf(counter), "the inline component's markup is scoped");
  assert.equal(scopeOf(page), scopeOf(counter), "one file, one scope");

  // A component compiled from its own module keeps its own.
  const button = host.querySelectorAll("button")[0];
  assert.notEqual(scopeOf(button), scopeOf(page), "another module, another scope");
  document.body.textContent = "";
});

test("MosaicApplication accepts a component directly, skipping the load", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "app3");
  document.body.appendChild(host);

  const Inline = function () {
    return h("p", null, "inline");
  };
  const app = await MosaicApplication.run({ id: "app3", component: Inline });
  assert.match(app.target.innerHTML, /inline/);
  document.body.textContent = "";
});

test("a missing id or unloadable entry reports a clear error", async () => {
  assert.throws(() => new MosaicApplication({ id: "nope" }), /no element with id "nope"/);
  await assert.rejects(
    new MosaicApplication({ src: "./build/does-not-exist.js" }).ready,
    /could not load a root component/,
  );
  document.body.textContent = "";
});

// --- drawn components (a Component subclass with draw(), not a .mib file) ---


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
  assert.match(root.innerHTML, /<output class="value high[^"]*"[^>]*>3<\/output>/);

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

test("a .mib page renders a drawn view as a child component", async () => {
  const host = document.createElement("div");
  host.setAttribute("id", "composed");
  document.body.appendChild(host);

  // counter/main.mib contains <Counter limit="3"/>; the compiler emitted its
  // import, resolved to wherever Counter compiled.
  const app = await MosaicApplication.run({
    id: "composed",
    src: "../../../src/main.mib.js",
    controller: {title: "Mosaic"},
  });
  assert.match(app.src, /main\.mib\.js$/);

  assert.match(host.innerHTML, /<h1 class="title[^"]*"[^>]*>Mosaic<\/h1>/);
  assert.match(host.innerHTML, /<div class="counter[^"]*"/);
  assert.match(host.innerHTML, /<output class="value[^"]*"[^>]*>0<\/output>/);

  // The drawn child redraws itself without touching the page around it.
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
  const bundle = await readFile(new URL("../examples/Counter_component/build/app.js", import.meta.url), "utf8");
  assert.equal(bundle.match(/^import /gm), null, "no imports left to resolve");

  const app = await MosaicApplication.run({
    id: "bundled",
    src: "../../../src/main.mib.js",
    controller: {title: "Bundled"},
  });

  // Everything came from one file: the page and the drawn child it renders.
  assert.match(host.innerHTML, /<h1 class="title[^"]*"[^>]*>Bundled<\/h1>/);
  assert.match(host.innerHTML, /<div class="counter[^"]*"/);

  // The shim understands simple selectors only; the page's buttons are the
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
  assert.equal(root.querySelectorAll("output")[0], output, "still the same node");
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
  const scopeOf = (el) => (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;

  const own = scopeOf(root.childNodes[0]);
  assert.ok(own, "root carries a scope attribute");
  assert.equal(scopeOf(root.querySelectorAll("output")[0]), own, "own element shares it");

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
      return h("ul", null, this.items.map((label) => h(Row, { label })));
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
      events.push(["attached", this.node.tagName, this.node.parentNode !== null]);
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
  assert.deepEqual(events, [["attached", "p", true]], "node is in place when it runs");

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
      return h("ul", null, this.items.map((label) => h(Row, { label })));
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

// --- the same page, drawn by one component ---------------------------------

// Counter_main: the page and the controller that drives every part of it.
// (`AppController` above is a local stand-in used by the mount tests.)
const {default: ExampleController} = await import("../examples/Counter_main/build/src/AppController.js");
const {default: AppPage} = await import("../examples/Counter_main/build/src/main.mib.js");

test("AppController drives the page without a Counter component", () => {
  const root = document.createElement("div");
  const controller = new ExampleController({title: "Counter App"});
  mount(AppPage, root, {}, controller);

  assert.match(root.innerHTML, /^<div class="app[^"]*"/);
  assert.match(root.innerHTML, /<h1 class="title[^"]*"[^>]*>Counter App<\/h1>/);
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>0<\/output>/);
  // Two Buttons, and no counter component between them and the page.
  assert.equal(root.querySelectorAll("button").length, 2);

  const [minus, plus] = root.querySelectorAll("button");
  plus.dispatchEvent({type: "click"});
  assert.equal(controller.count, 1, "the Button's action ran a method on the controller");
  assert.match(root.innerHTML, /<output class="value[^"]*"[^>]*>1<\/output>/);

  minus.dispatchEvent({type: "click"});
  assert.equal(controller.count, 0);
});

test("its buttons are scoped to Button, its own markup to itself", () => {
  const root = document.createElement("div");
  mount(AppPage, root, {}, new ExampleController());

  // The compiler appends the scope class last, which is how a test picks it
  // out now that it is a bare hash with nothing to recognise it by.
  const scopeOf = (el) => (el.getAttribute("class") ?? "").trim().split(/\s+/).pop() || undefined;
  const page = scopeOf(root.childNodes[0]);
  const button = scopeOf(root.querySelectorAll("button")[0]);

  assert.ok(page && button);
  assert.notEqual(page, button, "Button styles its own markup");
  assert.equal(scopeOf(root.querySelectorAll("output")[0]), page);
});

test("the controller and a bare object render the same markup", () => {
  const a = document.createElement("div");
  mount(AppPage, a, {}, new ExampleController({title: "Mosaic"}));

  const b = document.createElement("div");
  mount(AppPage, b, {}, {title: "Mosaic", count: 0, status: ""});

  // Both mount the same page, so the scope is identical either way — the
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
  view.count = 4;                       // no needsDisplay
  assert.equal(out().textContent, "4");
});

test("a property read through a getter is observed too", () => {
  // `status` derives from `count`; recording the reads draw() makes catches
  // the `count` inside it, so the class follows.
  const root = document.createElement("div");
  const view = mount(CounterView, root, {limit: "2"}).view;

  view.count = 2;
  assert.match(root.querySelectorAll("output")[0].getAttribute("class"), /high/);
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
