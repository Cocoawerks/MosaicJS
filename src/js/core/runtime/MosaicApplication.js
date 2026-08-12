// The application entry point.
import {mount} from "./mount.js";

/**
 * The application entry point.
 *
 *   new MosaicApplication();                       // mounts Main into <body>
 *   new MosaicApplication({ id: "app" });          // ...into #app
 *   new MosaicApplication({ controller: new AppController() });
 *
 * The page is found for you. A `main.js` beside a `main.mib` is the application
 * entry, so the compiler registers the compiled page as `MosaicApplication.page`
 * — nothing has to name it. Pass `component` to mount something else.
 *
 * Everything it mounts is something the entry already imported, so the whole
 * application is in the bundle and nothing is fetched at run time: the page is
 * in hand before the first line of application code runs, and mounting is
 * synchronous. `ready` and `run()` remain, so code that awaits them still
 * reads the same — there is simply nothing left to wait for.
 */
export class MosaicApplication {
  /**
   * The application's page, registered by the compiled entry. Set at import
   * time, before any application code runs, so `new MosaicApplication()` has
   * it without a path to resolve or a module to fetch.
   */
  static page = null;

  /** Called by compiled code: `main.mib` is the page of the app it belongs to. */
  static registerPage(component) {
    MosaicApplication.page = component;
  }

  constructor(props = {}) {
    const {id, target, component, controller, ...rest} = props;

    this.controller = controller ?? {};
    this.props = rest;
    this.target = resolveTarget(id, target);
    this.view = null;
    this.unmount = () => {};

    this.ready = Promise.resolve(this.#start(component));
  }

  /** Construct and await in one step: `const app = await MosaicApplication.run()`. */
  static run(props) {
    const app = new MosaicApplication(props);
    return app.ready.then(() => app);
  }

  #start(component) {
    // An explicit component wins; otherwise it is the page the compiled entry
    // registered when it was imported.
    const Component = component ?? MosaicApplication.page;
    if (typeof Component !== "function") {
      throw new Error(
          "MosaicApplication has no root component to mount. A `main.js` beside a " +
          "`main.mib` registers one when it is compiled — otherwise pass { component }.",
      );
    }

    this.unmount = mount(Component, this.target, this.props, this.controller);
    this.view = this.controller.view;
    return this;
  }
}

/** `id` names an element; `target` accepts an element or a selector. */
function resolveTarget(id, target) {
  if (id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MosaicApplication: no element with id "${id}"`);
    return el;
  }
  if (typeof target === "string") {
    const el = document.querySelector(target);
    if (!el) throw new Error(`MosaicApplication: no element matching "${target}"`);
    return el;
  }
  return target ?? document.body;
}
