// The application entry point.
import { mount } from "./private/mount.js";

/**
 * The application entry point.
 *
 *   new MosaicApplication();                       // mounts Main into <body>
 *   new MosaicApplication({ id: "app" });          // ...into #app
 *   new MosaicApplication({ controller: new AppController() });
 *
 * The interface is found for you. A `main.js` beside a `main.ib.xml` is the
 * application entry, so the compiler registers the compiled interface as
 * `MosaicApplication.mainMib` — nothing has to name it. Pass `component` to
 * mount something else.
 *
 * Everything it mounts is something the entry already imported, so the whole
 * application is in the bundle and nothing is fetched at run time: the interface
 * is in hand before the first line of application code runs, and mounting is
 * synchronous. `ready` remains, so code that awaits it still reads the same —
 * there is simply nothing left to wait for.
 */
export class MosaicApplication {
  /**
   * The application's main interface — the compiled `main.ib.xml` (Mib).
   */
  static mainMib = null;

  /** Called by compiled code: `main.ib.xml` is the interface of the app it belongs to. */
  static registerMib(component) {
    MosaicApplication.mainMib = component;
  }

  constructor(props = {}) {
    const { id, target, component, controller, ...rest } = props;

    // Left unset rather than defaulted to an empty object: `mount` reads
    // "nothing was said" as "use the controller the interface was compiled
    // with", and an empty object is something said. A `main.ib.xml` paired with
    // a `MainController.js` beside it was therefore mounted against a bare
    // object at the application root, while the same interface placed as a tag
    // got its controller — the pairing worked everywhere but the one place an
    // interface is usually used.
    this.controller = controller ?? null;
    this.props = rest;
    this.target = resolveTarget(id, target);
    this.view = null;
    this.unmount = () => {};

    this.ready = Promise.resolve(this.#start(component));
  }

  #start(component) {
    // An explicit component wins; otherwise it is the interface the compiled
    // entry registered when it was imported.
    const Component = component ?? MosaicApplication.mainMib;
    if (typeof Component !== "function") {
      throw new Error(
        "MosaicApplication has no root component to mount. A `main.js` beside a " +
          "`main.ib.xml` registers one when it is compiled — otherwise pass { component }.",
      );
    }

    this.unmount = mount(
      Component,
      this.target,
      this.props,
      this.controller ?? undefined,
    );
    // Whatever it ended up drawing against, which is the interface's own when
    // nothing was passed.
    this.controller = this.unmount.view?.controller ?? this.controller ?? {};
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
    if (!el)
      throw new Error(`MosaicApplication: no element matching "${target}"`);
    return el;
  }
  return target ?? document.body;
}
