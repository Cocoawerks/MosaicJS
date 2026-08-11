// The application entry point.
import { mount } from "./mount.js";

/**
 * The application entry point.
 *
 *   new MosaicApplication();                       // mounts Main into <body>
 *   new MosaicApplication({ id: "app" });          // ...into #app
 *   new MosaicApplication({ controller: new AppController() });
 *
 * It finds the compiled root component itself — the bundle `app.js`, else
 * `Main.js` or `main.js` in `build/` — mounts it, and needs no `mount()` call. Loading a module is
 * asynchronous, so `await app.ready` (or `MosaicApplication.run(...)`) when you
 * need the mounted view; pass `component` to skip loading entirely.
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
  static entryNames = ["main.ib.js", "Main.js", "main.js"];

  constructor(props = {}) {
    const { id, target, src, component, controller = {}, ...rest } = props;

    this.controller = controller;
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
    const Component = component ?? (await this.#loadComponent(src));
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
        "Compile main.ib into build/, or pass { src } or { component }.",
    );
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
