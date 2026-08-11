# ibcompile

A Svelte-style compiler in Rust. It takes components and emits plain JavaScript
that builds the DOM through a Preact-style `h()` function. Two source kinds:

- **`.ib`** — markup with a scoped `<style>` block, compiled to a component
  function. `{path}` bindings read the controller.
- **`.js` / `.jsx`** — JavaScript whose JSX is rewritten into `h()` calls,
  typically a `View` subclass with a `draw()` method. Full JavaScript;
  `import "./name.css"` is inlined, but there is no scoping.

There is no reactivity. Markup declares *structure* and reads values from a
controller with `{path}`; the controller owns all state and decides when the DOM
updates. Two directives complete the picture — `ib:outlet` hands nodes to the
controller, and `ib:action` wires events to its methods.

The compiler emits **no runtime code**. Everything shared lives in `src/runtime/mosaic.js`,
which compiled modules import.

## Drawn views: draw() as an alternative to .ib

A `View` subclass can implement `draw(props)` and return JSX. The compiler turns
the JSX into `h()` calls; `needsDisplay()` re-runs `draw()` and swaps the result
into place, so the same method that renders also updates:

```jsx
// examples/Counter.js  ->  build/Counter.js
import { View } from "../mosaic.js";
import "./counter.css";              // inlined into addStyles() at compile time

export default class Counter extends View {
  constructor() {
    super();
    this.count = 0;
  }

  get limit() {
    return Number(this.props.limit ?? 3);   // props come from the markup
  }

  increment() {
    this.count += 1;
    this.needsDisplay();               // re-runs draw()
  }

  draw() {
    return (
      <View styleName="counter">
        <button styleName="step" ib:action="decrement">-</button>
        <output styleName={this.count >= this.limit ? "value high" : "value"}>{this.count}</output>
        <button styleName="step" ib:action="increment">+</button>
      </View>
    );
  }
}
```

A `.ib` page uses it like any component, and the compiler emits the import:

```html
<!-- examples/main.ib -->
<View styleName="app">
  <h1 styleName="title">{title}</h1>
  <Counter limit="3" />
</View>
```

```js
import Counter from "./Counter.js";   // emitted by the compiler
…
h(Counter, { limit: "3" })
```

Each capitalised tag is imported from `./<Name>.js` next to the compiled
output, so component files must be named after the tag.

### Stylesheets in .js sources

`import "./counter.css";` is replaced at compile time with an `addStyles()`
call holding the file's contents, so it works in a browser with no bundler.
Those selectors are **global** — scoped CSS needs markup to attach the scope
attribute to, which is what `.ib` provides.

A drawn view is its own controller — `ib:action` and `ib:outlet` bind to the
instance, and `this` inside `draw()` is the view.

**How the two kinds differ**

| | `.ib` | `.jsx` `draw()` |
| --- | --- | --- |
| Inside `{...}` | a property path | any JavaScript expression |
| Conditionals / lists | build them from a controller | `? :` and `.map()`, inline |
| `needsDisplay()` | re-reads `{path}` bindings | re-runs `draw()` |
| Scoped CSS | yes, from `<style>` | no — call `addStyles()` yourself |
| Controller | a separate object | the view itself |

A redraw rebuilds the whole subtree — there is no diffing — so keep values, not
nodes, between draws. `styleName`, `ib:outlet` and `ib:action` mean the same in
both, and `<View>` is a `<div>` in both.

## The application entry point

`MosaicApplication` is the whole startup path. It finds the compiled root
component itself — `Main.js` or `main.js` under `build/` — mounts it, and adds it
to `<body>` or to the element named by an `id` prop:

```html
<div id="app"></div>
<script type="module">
  import { MosaicApplication } from "../mosaic.js";

  class AppController {
    constructor() {
      this.title = "Mosaic";
      this.count = 0;
    }
    increment() {
      this.count += 1;
      this.view.needsDisplay();
    }
  }

  new MosaicApplication({ id: "app", controller: new AppController() });
</script>
```

No `mount()` call and no import of the component. Write the root page in
`main.ib` (or `Main.ib`) and compile it into `build/`.

| Prop | Effect |
| --- | --- |
| `id` | mount into `document.getElementById(id)`; defaults to `<body>` |
| `target` | an element or selector, if you would rather pass it directly |
| `controller` | the controller object; gets `this.view` |
| `src` | an explicit module path, instead of the `Main.js` / `main.js` search |
| `component` | a component function, skipping module loading entirely |

Anything else is passed to the component as props.

Loading a module is asynchronous, so the DOM is not in place the instant the
constructor returns. Await it when that matters:

```js
const app = await MosaicApplication.run({ id: "app", controller });
app.view.node;   // the root element
app.unmount();
```

The instance exposes `view`, `controller`, `target`, `src` and `unmount`.

## Build & run

### One payload

`--bundle` combines every compiled module into a single file with a source map,
instead of writing them separately:

```sh
cargo run -- examples --bundle build/app.js
```

```
bundled 4 modules -> build/app.js (+ app.js.map)
```

The bundle hoists one runtime import, drops the imports between your own
modules (they are neighbours in one scope now), orders them so a component is
defined before the page that renders it, and default-exports the entry
component — `Main` by default, `--entry Name` to choose another.

`build/app.js.map` is a v3 source map with the original `.ib` and `.js` sources
inlined, so browser devtools show your markup rather than generated `h()` calls.
Mapping is line-level: each generated line points at the markup line or JS line
it came from.

`MosaicApplication` prefers `app.js` over `Main.js`/`main.js`, so the app loads
the bundle when one exists with no change to your page.

```sh
cargo build --release
cargo run -- examples --outdir build --runtime ../mosaic.js
```

```
usage: ibcompile <input.ib|input.js|input.jsx|dir> [-o out.js] [--outdir dir]
                 [--bundle build/app.js [--entry Main]]
                 [--runtime ./mosaic.js] [--name Component]
```

Passing a directory compiles every `.ib` and `.jsx` file in it (requires
`--outdir`).
The exported component name defaults to the PascalCased file stem.

## Component syntax

```html
<View styleName="counter">
  <button styleName="step" ib:action="decrement">-</button>
  <output styleName="value {status}">{count}</output>
  <button styleName="step" ib:outlet="plus" ib:action="increment">+</button>
</View>

<style>
  .counter { display: flex; gap: 0.5rem; }
  .step { width: 2rem; }
  :global(body) { margin: 0; }
</style>
```

| Feature | Syntax | Compiles to |
| --- | --- | --- |
| View | `<View styleName="box">` | `h("div", { class: "box" }, …)` — the root element |
| Element | `<div styleName="box">text</div>` | `h("div", { class: "box" }, "text")` |
| CSS class | `styleName="box"` (every tag) | `class: "box"` — `class` is a compile error |
| Binding | `{count}` | `bindText(this, "count")` — reads `this.count` |
| Binding, dotted | `{user.name}` | `bindText(this, "user.name")` |
| Attribute binding | `styleName="item {status}"` | `bindAttr(this, ["item ", { path: "status" }])` |
| Boolean attribute | `disabled` | `disabled: true` |
| Outlet | `ib:outlet="name"` | `ref` assigning the node to `this.name` |
| Action | `ib:action="increment"` | `onclick` calling `this.increment(event)` |
| Action, explicit event | `ib:action="input:onInput"` | `oninput` calling `this.onInput(event)` |
| Action, several events | `ib:action="click:go mouseenter:hover"` | one listener each |
| Components | `<Card title="hi"/>` | `h(Card, ...)` — capitalised tags are identifiers |
| Multiple roots | two top-level elements | `h(Fragment, null, ...)` |

Void elements (`<br>`, `<img>`, …) need no closing tag, and `<!-- comments -->`
are stripped.

**What is deliberately absent.** `{...}` holds a *property path*, not an
expression: there is no `{#if}`, no `{#each}`, no JavaScript in markup and no
`<script>` block. Each of these is a compile error that points at the
replacement:

```
line 4: `{count + 1}` is not a property path — bindings read a value from the
        controller, like {count} or {user.name}; compute anything else in a
        controller method
line 7: <script> is not supported — put behaviour in a controller and
        reach the DOM with ib:outlet
```

Derived values belong in a getter, which a binding reads like any other
property:

```js
get status() {
  return this.count >= 10 ? "high" : "";
}
```

## Views

`<View styleName="counter">` is the built-in root element. It renders a plain
`<div>` and is scoped like any other element, so `.counter` in `<style>`
matches it:

```html
<View styleName="counter">…</View>   →   <div class="counter" data-ib-x1y2>…</div>
```

`mount` creates a matching `View` object and hands it to the controller as
`this.view`. The controller stays a plain class — it does not extend anything:

```js
class CounterController {
  increment() {
    this.count += 1;
    this.view.needsDisplay();   // re-read this view's bindings
  }
}

mount(Counter, target, {}, controller);
controller.view.node;           // the root <div>
```

`<View>` takes `ib:outlet`, `ib:action` and any other attribute.

### styleName

Every element names its CSS class `styleName`, native tags included:

```html
<View styleName="counter">
  <button styleName="step">-</button>
  <output styleName="value {status}">{count}</output>
</View>
```

It compiles to `class` in the DOM, accepts bindings, and `class` in markup is a
compile error (`<button>: use `styleName` instead of `class``) so there is only
one spelling. The exception is a component tag — `<Card styleName="a"/>` passes
`styleName` through as an ordinary prop, since a component's props are not DOM
attributes.

## Bindings

`{count}` reads `this.count` from the controller. It is evaluated during
`mount`, and again whenever the controller calls `refresh(this)` — never on its
own. This is a one-way read: a binding pulls from the controller, and nothing
watches for changes.

```html
<output class="value {status}">{count}</output>
```

```js
import { mount } from "./mosaic.js";

class CounterController {
  constructor(start) {
    this.count = start;
  }
  get status() {                    // {status} reads this, like any property
    return this.count >= 10 ? "high" : "";
  }
  increment() {
    this.count += 1;
    this.view.needsDisplay();       // push {count} and {status} to the DOM
  }
}

mount(Counter, target, {}, new CounterController(0));  // renders "0"
```

Notes:

- A binding is a dotted path of identifiers — `{count}`, `{user.name}`. Anything
  else is a compile error.
- `null` and `undefined` render as empty text, so a path that does not exist
  yet is blank rather than `"undefined"`.
- `this.view.needsDisplay()` updates every binding that view rendered, in text
  and in attributes, and skips nodes no longer in the document. It applies
  immediately — the name marks intent, not a deferred repaint.
- `refresh(controller)` is the standalone equivalent, for an object that was
  never mounted.
- Bindings do not replace `ib:outlet`. Use a binding for a value that lands in
  text or an attribute; use an outlet when the controller needs the node itself
  (to set `disabled`, focus it, or build children into it).

## Outlets and actions

`ib:outlet="name"` binds the rendered node to `this.name`; `ib:action` binds
listeners to `this.method`. In both cases `this` is the controller the component
was mounted with:

```js
import { mount } from "./mosaic.js";
import Counter from "./build/counter.js";

class CounterController {
  constructor(start) {
    this.count = start;
  }
  increment() {            // ib:action="increment" calls this
    this.count += 1;
    this.view.needsDisplay();   // {count} updates; `plus` is the node itself
    this.plus.disabled = this.count >= 10;
  }
  decrement() {
    this.count -= 1;
    this.view.needsDisplay();
    this.plus.disabled = this.count >= 10;
  }
}

const counter = new CounterController(0);
mount(Counter, target, {}, counter);
```

They compile to a `ref` and a listener, both arrow functions so `this` stays the
controller:

```js
h("output", { ref: (__el) => { this.value = __el; } }, "0")
h("button", { onclick: (...__a) => this.increment(...__a) }, "+")
```

Notes:

- An outlet name must be a quoted identifier. `ib:action` takes `event:method`
  pairs, whitespace-separated; a bare `method` means `click`.
- Outlet names must be unique within a file, and may not collide with an action
  method name — the node would overwrite the method. Both are compile errors.
- Outlets are assigned during `mount`, so they are available as soon as it
  returns. A controller's `render()` must be called by you, after mounting.
- Action lookup is late: `this.increment` is resolved when the event fires, so
  methods can be defined or swapped any time after mount.
- The directives never reach the DOM — there is no `ib:outlet` or `ib:action`
  attribute in the output.
- Anything dynamic — a list, a conditional branch — is built by the controller
  into an empty outlet (`<ul ib:outlet="list"></ul>`). For list rows, bind one
  delegated `ib:action` on the container rather than per row.

## Props

`props` are plain initial values, read once during the render that `mount`
performs. They are not bindings, and nothing re-renders when they change. Since
markup is static, a component's own template cannot reference them; they are
there for the component function and for anything it forwards to children.

## Controllers

A controller is a plain class. `mount` attaches the view as `this.view`, so
`this.view.needsDisplay()` refreshes the bindings it rendered:

```js
class CounterController {
  increment() {
    this.count += 1;
    this.view.needsDisplay();
  }
}
```

A mounted tree has exactly one controller, threaded through nested components
too — static markup has no way to hand a child its own. Outlets and actions in a
child component therefore bind to the same object as the parent's.

## Scoped CSS

Each file gets a hash-derived attribute (`data-ib-<hash>`). Every element in
the file's markup carries it, and every selector in `<style>` is rewritten to
require it:

```css
.box span      →  .box span[data-ib-x1y2]
a::before      →  a[data-ib-x1y2]::before
@media (…) { .a { } }  →  @media (…) { .a[data-ib-x1y2] { } }
@keyframes spin { … }  →  unchanged
:global(body)  →  body
```

The scoped CSS is emitted as a `const CSS` string and registered once per page
via `addStyles(hash, CSS)` at module scope. Components rendered as children are
not given the parent's scope attribute — each file styles only its own markup.

Nodes a controller builds itself do **not** carry the scope attribute, so the
component's scoped CSS will not match them. (Those are plain DOM calls, so they
use `class`/`className` as usual — `styleName` is markup syntax only.) Style controller-built content with
`:global(...)`, or set the attribute yourself when you create the node.

## Runtime API (`src/runtime/mosaic.js`)

- `h(type, props, ...children)` — create a vnode; children flatten, and
  `null`/`undefined`/booleans are dropped.
- `bindText(controller, path)` / `bindAttr(controller, parts)` — what `{path}`
  compiles to; you rarely call these directly.
- `refresh(controller)` — re-read every binding this controller rendered and
  write changed values back to the DOM.
- `View` — base class for drawn views (implement `draw(props)`), and the object
  `mount` creates for a `.ib` component. `mount` creates one, assigns it to
  `controller.view`, and exposes `view.node` (the root element) and
  `view.needsDisplay()`.
- `MosaicApplication` — the entry point: loads `build/Main.js` or
  `build/main.js`, mounts it into `<body>` or `#id`, and needs no `mount()`
  call. `MosaicApplication.run(props)` resolves once mounted.
- `Fragment` — multi-root marker.
- `render(vnode, controller)` — vnode → DOM node.
- `mount(component, target, props, controller)` — render into `target` with
  `controller` as the component's `this`; returns an unmount fn.
- `addStyles(hash, css)` — inject a component's CSS once.
- `collectStyles()` — concatenate all injected CSS.

Props are applied DOM-first: `on*` functions become listeners, `ref` accepts a
function or `{ current }` and is what `ib:outlet` compiles to, `style` accepts
an object (including custom properties), `class` accepts a string, array or
`{ name: enabled }` object, and `value`/`checked`/`selected` are set as
properties rather than attributes.

## Tests

```sh
cargo test                        # parser, directives, CSS scoping, codegen
node --test test/render.test.mjs  # compiled output + runtime, on a small DOM shim
```

The JS tests load the compiled examples, so build them first:

```sh
cargo run -- examples --outdir build --runtime ../mosaic.js
```

### In a browser

```sh
./dev.sh            # build, serve on :8000, open the app
./dev.sh --check    # headless smoke test, prints PASS/FAIL, exits non-zero on failure
./dev.sh --no-open  # serve only
./dev.sh --port 9000
```

The node tests run against a small DOM shim. `examples/browser-check.html` runs
the same kind of assertions in a real engine — real events, real
`getComputedStyle`, so it also proves the scoped CSS applies. Serve the repo
root (the pages import `../mosaic.js`, which `file://` will not allow):

```sh
python3 -m http.server 8000
```

- `http://localhost:8000/examples/` — the app (`examples/index.html`), started
  by `MosaicApplication`.
- `http://localhost:8000/examples/browser-check.html` — the smoke test; every
  assertion prints, and the tab title reads PASS or FAIL.

Headless, for CI:

```sh
chromium --headless --dump-dom http://localhost:8000/examples/browser-check.html \
  | grep -E "PASS|FAIL"
```
