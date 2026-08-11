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
 * — nothing has to name it. Pass `component` to mount something else, or `src`
 * to load a module by path.
 *
 * Loading a module is asynchronous, so `await app.ready` (or
 * `MosaicApplication.run(...)`) when you need the mounted view. A registered
 * page is already in hand, and mounts synchronously.
 */
export class MosaicApplication {
  /**
   * Where compiled components live, resolved against this module's URL —
   * mosaic.js sits in src/js/runtime/, so build/ is three levels up. Override
   * it if your output lands elsewhere.
   */
  static base = "../../../build/";
  /**
   * Tried in order when no `src` or `component` is given. A bundle is not on
   * the list: it is built from a bootstrap that mounts on load, so it exports
   * no root component to find.
   */
  static entryNames = ["main.mib.js", "Main.js", "main.js"];
  /**
   * The application's page, registered by the compiled entry. Set at import
   * time, before any application code runs, so `new MosaicApplication()` has
   * it without a path to resolve or a module to fetch.
   */
  static page = null;

  /**
   * The application's controller, registered by a `<script>` block in the
   * page. Held as declared — a class is constructed when the app starts, an
   * object is used as it is.
   */
  static controller = null;

  /** Called by compiled code: `main.mib` is the page of the app it belongs to. */
  static registerPage(component) {
    MosaicApplication.page = component;
  }

  /** Called by compiled code: the page declared its own controller. */
  static registerController(controller) {
    MosaicApplication.controller = controller;
  }

  constructor(props = {}) {
    const {id, target, src, component, controller, ...rest} = props;

    this.controller = controller ?? defaultController();
    this.props = rest;
    this.target = resolveTarget(id, target);
    this.view = null;
    this.unmount = () => {};

    this.ready = this.#start({ src, component });
  }

  /** Construct and await in one step: `const app = await MosaicApplication.run()`. */
  static run(props) {
    const app = new MosaicApplication(props);
    return app.ready.then(() => app);
  }

  async #start({ src, component }) {
    // An explicit component wins; then the page the compiled entry registered;
    // then, only if neither is there, a module is fetched by path.
    const registered = src ? null : MosaicApplication.page;
    const Component = component ?? registered ?? (await this.#loadComponent(src));
    this.unmount = mount(Component, this.target, this.props, this.controller);
    this.view = this.controller.view;
    return this;
  }

  async #loadComponent(src) {
    const candidates = src
      ? [src]
      : MosaicApplication.entryNames.map((n) => MosaicApplication.base + n);

    const failures = [];
    for (const path of candidates) {
      try {
        const module = await import(path);
        const Component = module.default;
        if (typeof Component !== "function") {
          throw new Error(`${path} has no default-exported component`);
        }
        this.src = path;
        return Component;
      } catch (error) {
        failures.push(`${path}: ${error.message}`);
      }
    }
    throw new Error(
      `MosaicApplication could not load a root component. Tried:\n  ${failures.join("\n  ")}\n` +
        "Compile main.mib into build/, or pass { src } or { component }.",
    );
  }
}

/**
 * The controller to use when none was passed: the one the page registered, or
 * a bare object. A class is constructed; anything else is used as it stands.
 */
function defaultController() {
  const registered = MosaicApplication.controller;
  if (!registered) return {};
  return typeof registered === "function" ? new registered() : registered;
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
