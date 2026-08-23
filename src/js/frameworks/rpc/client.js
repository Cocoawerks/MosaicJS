// Calling a service: the half that runs in the page.
//
//   import { rpc } from "mosaic/frameworks/rpc";
//   const api = rpc();
//
//   this.notes = await api.notes.list({ tag: "one" });
//   const made = await api.notes.create({ title: "One" });
//
// `api.notes.list` is not a function anyone wrote. Reading `notes` and then
// `list` builds the name `"notes.list"`, and calling it sends that name and the
// arguments to whichever side holds the services. There is nothing to declare
// on this side and nothing to keep in step: a function a service exports is
// callable the moment it is written.
//
// What holds the services depends on how the application is running, and this
// is the one place that difference exists:
//
//   the desktop   the Electrobun main process, over that toolkit's own bridge
//   the web       whatever `mosaic web` is serving, over POST /rpc
//
// The transport is chosen by looking at what is there rather than by being
// told, so a controller is the same file in both — which is the whole reason
// this is worth having over calling `fetch` directly.
//
// A service that throws comes back as a rejected promise carrying an
// {@link RpcError}, so a call reads the way any other async call does:
//
//   try {
//     await api.notes.create({});
//   } catch (e) {
//     this.note = e.message;        // what the service said
//   }

/** What a call failed with, as the service on the other side reported it. */
export class RpcError extends Error {
  /**
   * @param {{name?: string, message?: string, data?: *, status?: number}} error
   * @param {string} method What was called.
   */
  constructor(error, method) {
    super(error?.message || `the call to ${method} failed`);
    this.name = "RpcError";
    /** @type {string} The error's own name, as it was thrown over there. */
    this.remoteName = error?.name ?? "Error";
    /** @type {string} The method that failed. */
    this.method = method;
    /** @type {*} Whatever the service attached — which field was wrong, say. */
    this.data = error?.data;
    /** @type {number|undefined} A status, for a service that meant one. */
    this.status = error?.status;
  }
}

/**
 * Where a call goes when the page is served over HTTP: one endpoint, one POST.
 *
 * Written on `fetch` rather than on the runtime's `Request`, though that class
 * would do the same job in a line. This framework has no business depending on
 * the runtime: what it needs is the four lines below, and standing on nothing
 * is what lets it be tested, and used, on its own. `Request` is for an
 * application talking to somebody else's server; this is talking to its own.
 */
function httpTransport(url) {
  return {
    kind: "http",
    async send(message) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(message),
      });

      // The host answers 200 with an envelope whichever way the call went: a
      // service refusing a call is the service's answer, not the request
      // failing. Anything else is the host itself failing, and says so.
      if (!response.ok) {
        throw new RpcError(
          {
            name: "HostError",
            message: `the rpc endpoint answered ${response.status} ${response.statusText}`,
            status: response.status,
          },
          message.method,
        );
      }
      return response.json();
    },
  };
}

/**
 * Where a host installs the transport its pages should use.
 *
 * A page is compiled once and run anywhere, so this file cannot import the
 * thing that talks to a desktop main process: an import of a toolkit is in
 * every build, including the one served to a browser that has no such toolkit.
 * The dependency is inverted instead — a host that has a way home puts it here
 * before the application starts, and a page that finds nothing posts over HTTP.
 *
 * `mosaic desktop` generates the module that fills this in, against Electrobun's
 * published `Electroview` client, and bundles it only into the desktop build.
 * `mosaic web` generates nothing, and this stays empty.
 *
 * The contract is one method: `send(message)` takes the dispatcher's envelope
 * and resolves to the dispatcher's answer.
 */
const INSTALLED = "mosaicRpcTransport";

/** The transport a host installed, if one did. */
function installedTransport() {
  const t = globalThis[INSTALLED];
  return t && typeof t.send === "function" ? t : null;
}

/** How a call is sent when nothing says otherwise. */
const defaults = {
  /** The endpoint the HTTP transport posts to. */
  url: "/rpc",
  /** Set to override what {@link rpc} would choose for itself. */
  transport: null,
};

/**
 * The transport this page should use, made once and kept.
 *
 * Chosen at the first call rather than when the client is made: a page's
 * modules run before the toolkit's preload has necessarily finished, and a
 * client built at import time would settle on HTTP for good.
 */
let chosen = null;

function transportFor(options) {
  if (options.transport) return options.transport;
  if (defaults.transport) return defaults.transport;
  if (chosen) return chosen;

  chosen =
    installedTransport() ?? httpTransport(options.url ?? defaults.url);
  return chosen;
}

/** Send one call, over whichever transport this client is to use. */
async function send(options, method, params) {
  const answer = await transportFor(options).send({ method, params });

  // One shape, both hosts: the dispatcher's envelope. Anything else is a host
  // that answered something other than what it was asked.
  if (!answer || typeof answer !== "object" || !("value" in answer || "error" in answer)) {
    throw new RpcError(
      { name: "BadAnswer", message: `${method} answered with something that is not an rpc reply` },
      method,
    );
  }
  if (answer.error) throw new RpcError(answer.error, method);
  return answer.value;
}

/**
 * Say where calls go, for an application whose services are not where they
 * would be looked for — a page served from one place and an API served from
 * another, or a test standing in for the whole thing.
 *
 *   Rpc.configure({ url: "https://api.example.com/rpc" });
 *   Rpc.configure({ transport: { send: async (m) => … } });   // a test
 */
export const Rpc = {
  configure(settings = {}) {
    if ("url" in settings) defaults.url = settings.url ?? "/rpc";
    if ("transport" in settings) defaults.transport = settings.transport;
    return { ...defaults };
  },

  /** What is configured now. */
  get settings() {
    return { ...defaults };
  },

  /** Whether this page is talking to a desktop main process rather than a server. */
  get onDesktop() {
    return installedTransport() !== null;
  },

  reset() {
    defaults.url = "/rpc";
    defaults.transport = null;
    chosen = null;
    return { ...defaults };
  },
};

/**
 * A client for the application's services.
 *
 *   const api = rpc();
 *   await api.notes.list();
 *
 * Made once and kept — there is no connection behind it and nothing to close,
 * so a module-level `const` beside the controller that uses it is the shape to
 * reach for.
 *
 * @param {{url?: string, transport?: {send: Function}}} [options]
 *   `url` overrides where the HTTP transport posts, for this client alone;
 *   `transport` replaces the choice entirely, which is what a test does.
 * @returns {object} a proxy: any `group.name` on it is a call.
 */
export function rpc(options = {}) {
  const at = (path) =>
    new Proxy(function callable() {}, {
      get(_, name) {
        // Two things a proxy is asked for that are not method names. A promise
        // library checking `then` on a plain object would otherwise be handed
        // a function and conclude this was a thenable — and `await api` would
        // hang forever waiting for a call nobody made.
        if (name === "then" || name === Symbol.toStringTag) return undefined;
        if (typeof name === "symbol") return undefined;
        return at([...path, name]);
      },

      apply(_, __, params) {
        if (path.length !== 2) {
          return Promise.reject(
            new RpcError(
              {
                name: "BadMethod",
                message:
                  `rpc calls are "group.name" — a service's file and the ` +
                  `function it exports. Called: ${path.join(".") || "(nothing)"}`,
              },
              path.join("."),
            ),
          );
        }
        return send(options, path.join("."), params);
      },
    });

  return at([]);
}

export default rpc;
