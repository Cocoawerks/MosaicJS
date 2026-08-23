// Answering a call: the half that runs where the services are.
//
// Both hosts end up here, and that is the point of the file. `mosaic web` runs
// it in its own Bun process behind a POST; `mosaic desktop` runs it in the
// Electrobun main process behind that toolkit's webview bridge. Which one an
// application is running under changes the wire and nothing else — a service
// that behaves one way on the desktop and another on the web would be a bug
// nobody could reproduce.
//
// A message is `{ id, method, params }`, where `method` is `"group.name"` —
// the file the service was written in, and the function it exported. What goes
// back is one of two shapes, never both:
//
//   { id, value }              it worked, and this is what it returned
//   { id, error: {name, message, data} }   it did not
//
// An error crosses as data rather than as an exception, because the wire has
// no exceptions: what the client does with it is throw one of its own, so a
// caller sees the failure where they made the call.

/** What a name may be made of. A method is `group.name`, and nothing else. */
const NAME = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

/**
 * The function a method name stands for, or null.
 *
 * Own properties only, and both halves checked separately. A dotted name is
 * not a path to walk: it is a group and a function, so `notes.constructor`,
 * `__proto__.x` and anything else reaching into the prototype chain finds
 * nothing rather than finding something a service never meant to publish.
 * Everything a page can name is something a service exported on purpose.
 */
export function methodFor(services, method) {
  if (typeof method !== "string" || !NAME.test(method)) return null;

  const [groupName, name] = method.split(".");
  if (!Object.hasOwn(services ?? {}, groupName)) return null;

  const group = services[groupName];
  if (!group || typeof group !== "object") return null;
  if (!Object.hasOwn(group, name)) return null;

  const fn = group[name];
  return typeof fn === "function" ? fn : null;
}

/**
 * Every method these services publish, `group.name`, sorted. What the CLI
 * prints when it starts, and what a client could ask for — a service that is
 * there is not a secret, and a name being callable is what the page can find
 * out by calling it.
 *
 * @returns {string[]}
 */
export function methodsOf(services) {
  const names = [];
  for (const groupName of Object.keys(services ?? {})) {
    const group = services[groupName];
    if (!group || typeof group !== "object") continue;
    for (const name of Object.keys(group)) {
      if (typeof group[name] === "function") names.push(`${groupName}.${name}`);
    }
  }
  return names.sort();
}

/**
 * Run one call and answer it.
 *
 * Never throws. A call that fails comes back as an error envelope, because the
 * host that called this is answering a request rather than running application
 * code: a service throwing must not take a window or a dev server down with
 * it, and the client is where that failure is meant to surface.
 *
 * @param {{id?: *, method: string, params?: Array}} message what was asked
 * @param {object} services  the service objects, by group name
 * @param {object} [context] what the host knows about the caller — the Request
 *   on the web, the window on the desktop. Passed to a service that declares a
 *   second-to-last parameter for it; see below.
 * @returns {Promise<{id: *, value?: *, error?: object}>}
 */
export async function dispatch(message, services, context = null) {
  const { id = null, method, params } = message ?? {};

  const fn = methodFor(services, method);
  if (!fn) {
    return {
      id,
      error: {
        name: "NoSuchMethod",
        message: `no rpc method "${method}"`,
        data: { method },
      },
    };
  }

  const args = Array.isArray(params) ? params : params === undefined ? [] : [params];

  try {
    // The context rides on the call rather than in the arguments: a service
    // that wants to know who is asking reads `this.context`, and one that does
    // not is written as though it were an ordinary function. Putting it in the
    // arguments would mean every service counting its parameters.
    const value = await fn.apply({ context, method, services }, args);
    return { id, value: value === undefined ? null : value };
  } catch (e) {
    return { id, error: errorData(e) };
  }
}

/**
 * An error as something that can cross a wire.
 *
 * The message and the name, and whatever the service attached as `data` — a
 * validation failure saying which field. Not the stack: it is the server's
 * file paths, and it belongs in the server's log rather than in a page.
 */
export function errorData(e) {
  if (!e || typeof e !== "object") {
    return { name: "Error", message: String(e ?? "the call failed") };
  }
  const data = { name: e.name || "Error", message: e.message || String(e) };
  if (e.data !== undefined) data.data = e.data;
  // A service may say what status it means, for the host that has one to say
  // it with. Nothing is inferred: a thrown Error is a 500 until it says so.
  if (typeof e.status === "number") data.status = e.status;
  return data;
}
