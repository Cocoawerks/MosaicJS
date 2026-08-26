// Request — talking to a server, in one line per call.
//
//   const user = await Request.get("/api/users/1");
//   const made = await Request.post("/api/users", { name: "Ada" });
//   await Request.delete(`/api/users/${user.id}`);
//
// `fetch` is what this is built on, and everything it asks a caller to
// remember is what this is for: JSON has to be stringified going out and
// parsed coming back, the content type has to be stated, and — the one that
// costs an afternoon — a 404 is a *successful* fetch. `response.ok` is the
// only thing that says otherwise, and code that forgets to ask it carries on
// with an error page's HTML where it thought it had a record.
//
// So: a body goes out as JSON and comes back parsed, and a response the server
// refused throws a {@link RequestError} carrying the status and whatever the
// server said about it. What a caller writes is what it wanted:
//
//   try {
//     this.user = await Request.get("/api/users/1");
//   } catch (e) {
//     this.note = e.status === 404 ? "no such user" : e.message;
//   }
//
// Every method returns a promise, so `await` is the way to read one, and a
// controller method doing this is an ordinary `async` method — assigning what
// comes back is what updates the page, the same as assigning anything else.
//
// A `data` object means different things by method, because it means different
// things in HTTP: on a GET or a DELETE it is the query string, on a POST, PUT
// or PATCH it is the body. That is the one thing to know about this class.

/**
 * A response the server refused: any status outside 200–299.
 *
 * `status` is what to branch on. `body` is whatever the server sent with it,
 * parsed as JSON when it said so and left as text when it did not — an error
 * page is worth reading, and worth not throwing away.
 */
export class RequestError extends Error {
  /**
   * @param {Response} response The response as it arrived.
   * @param {*} body What it carried, parsed as far as it could be.
   */
  constructor(response, body) {
    // The server's own words first, if it gave any: `{"error": "no such user"}`
    // says more than "404 Not Found" does, and it is what a page would show.
    const said =
      (body && typeof body === "object" && (body.error ?? body.message)) ||
      (typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : "");

    super(
      `${response.status} ${response.statusText || "error"} — ` +
        `${response.url}${said ? `: ${said}` : ""}`,
    );

    this.name = "RequestError";
    /** @type {number} The HTTP status. */
    this.status = response.status;
    /** @type {string} The status text, as the server spelled it. */
    this.statusText = response.statusText;
    /** @type {string} What was asked for. */
    this.url = response.url;
    /** @type {*} What came back with the refusal. */
    this.body = body;
    /** @type {Response} The response itself, for a caller that wants more. */
    this.response = response;
  }
}

/**
 * What is sent with every request unless a call says otherwise. An
 * application sets this once — a base URL, an authorization header — rather
 * than repeating it at every call site.
 *
 *   Request.configure({
 *     baseUrl: "https://api.example.com",
 *     headers: { Authorization: `Bearer ${token}` },
 *   });
 */
const defaults = {
  /** Prefixed to a path that is not already a full URL. */
  baseUrl: "",
  /** Sent with every request; a call's own headers win over these. */
  headers: {},
  /** Whether cookies ride along — `fetch`'s own setting, and its default. */
  credentials: "same-origin",
  /** How long a request may take before it is abandoned, in ms. 0 is forever. */
  timeout: 0,
};

/** Nothing to send: `undefined` and `null` are "no data", not "empty data". */
function isEmpty(data) {
  return data === undefined || data === null;
}

/**
 * `url` with `data` on the end of it as a query string.
 *
 * An array becomes the same key repeated, which is what every server-side
 * framework reads back as a list. `null` and `undefined` are left out
 * altogether rather than sent as the strings "null" and "undefined" — a
 * parameter with nothing in it is a parameter not being sent.
 */
function withQuery(url, data) {
  if (isEmpty(data)) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (isEmpty(value)) continue;
    if (Array.isArray(value)) {
      for (const one of value) {
        if (!isEmpty(one)) params.append(key, String(one));
      }
    } else {
      params.append(key, String(value));
    }
  }

  const query = params.toString();
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
}

/** A path against the configured base; a full URL is left as it is. */
function resolve(url) {
  const base = defaults.baseUrl;
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return url;
  }
  return `${base.replace(/\/+$/, "")}/${String(url).replace(/^\/+/, "")}`;
}

/**
 * What a response carried.
 *
 * A body is parsed by what the server said it is, not by hoping: JSON when the
 * content type says JSON, text otherwise. A 204, or any response with nothing
 * in it, is `null` — a caller awaiting a DELETE wants to know it worked, and
 * there is nothing else to hand it.
 */
async function bodyOf(response) {
  if (response.status === 204 || response.status === 205) return null;

  const type = response.headers?.get?.("content-type") ?? "";
  const text = await response.text();
  if (text === "") return null;

  if (/\bjson\b/i.test(type)) {
    try {
      return JSON.parse(text);
    } catch {
      // A server that says JSON and sends something else is worth seeing
      // rather than failing over: the text is what it actually sent.
      return text;
    }
  }
  return text;
}

/**
 * The signal that ends a request: the caller's, this call's timeout, or both.
 *
 * @returns {AbortSignal|undefined}
 */
function signalFor(options) {
  const timeout = options.timeout ?? defaults.timeout;
  if (!timeout || typeof AbortSignal?.timeout !== "function") {
    return options.signal;
  }

  const limit = AbortSignal.timeout(timeout);
  if (!options.signal) return limit;
  // Either one may end it. `any` is recent; without it the caller's own signal
  // is the one that counts, since that is the one they can act on.
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([options.signal, limit])
    : options.signal;
}

/**
 * Talking to a server. Every method is static — there is nothing to construct,
 * and a request is a call rather than a thing to hold.
 *
 *   const list = await Request.get("/api/notes");
 *   const made = await Request.post("/api/notes", { title: "One" });
 *   const same = await Request.put(`/api/notes/${made.id}`, { title: "Two" });
 *   await Request.delete(`/api/notes/${made.id}`);
 */
export class Request {
  /**
   * @public Set what every request sends unless it says otherwise. Merged into what is
   * already configured, so two calls each setting one thing keep both.
   *
   * @param {{baseUrl?: string, headers?: object, credentials?: string,
   *   timeout?: number}} settings
   * @returns {object} the settings as they now stand.
   */
  static configure(settings = {}) {
    if ("baseUrl" in settings) defaults.baseUrl = settings.baseUrl ?? "";
    if ("credentials" in settings) defaults.credentials = settings.credentials;
    if ("timeout" in settings) defaults.timeout = Number(settings.timeout) || 0;

    if (settings.headers) {
      const merged = { ...defaults.headers };
      for (const [name, value] of Object.entries(settings.headers)) {
        // A header set to nothing is a header taken off — which is what
        // logging out does to an Authorization, and there is otherwise no way
        // to say it: merging cannot subtract.
        if (isEmpty(value)) delete merged[name];
        else merged[name] = value;
      }
      defaults.headers = merged;
    }
    return Request.settings;
  }

  /**
   * @public Forget everything configured: no base URL, no headers, `fetch`'s own
   * credentials, no timeout. What a test does between cases, and what an
   * application does when it no longer knows who is using it.
   */
  static reset() {
    defaults.baseUrl = "";
    defaults.headers = {};
    defaults.credentials = "same-origin";
    defaults.timeout = 0;
    return Request.settings;
  }

  /** @public What is configured now — for a test putting it back, or a page reading it. */
  static get settings() {
    return { ...defaults, headers: { ...defaults.headers } };
  }

  // --- the methods ----------------------------------------------------------

  /**
   * @public Fetch something. `data` is the query string, since a GET has no body.
   *
   *   await Request.get("/api/notes", { since: "2026-01-01", tag: ["a", "b"] });
   *
   * @param {string} url      the endpoint, absolute or against `baseUrl`
   * @param {object} [data]   what goes on the end as `?a=1&b=2`
   * @param {object} [options] see {@link Request.send}
   * @returns {Promise<*>} what the server sent, parsed.
   */
  static get(url, data, options) {
    return Request.send("GET", url, data, options);
  }

  /**
   * @public Send something and make something. `data` is the body, as JSON.
   *
   * @param {string} url
   * @param {object} [data]   the body
   * @param {object} [options]
   * @returns {Promise<*>}
   */
  static post(url, data, options) {
    return Request.send("POST", url, data, options);
  }

  /**
   * @public `data` is the body, as JSON.
   *
   * @param {string} url
   * @param {object} [data]
   * @param {object} [options]
   * @returns {Promise<*>}
   */
  static put(url, data, options) {
    return Request.send("PUT", url, data, options);
  }

  /**
   * @public `data` is the body, as JSON.
   *
   * @param {string} url
   * @param {object} [data]
   * @param {object} [options]
   * @returns {Promise<*>}
   */
  static patch(url, data, options) {
    return Request.send("PATCH", url, data, options);
  }

  /**
   * @public `data` is the query string, as it is for a GET — a
   * DELETE that needs a body is rare enough to be worth saying out loud, and
   * `Request.send("DELETE", url, body, { body: true })` is how.
   *
   * @param {string} url
   * @param {object} [data]
   * @param {object} [options]
   * @returns {Promise<*>}
   */
  static delete(url, data, options) {
    return Request.send("DELETE", url, data, options);
  }

  /**
   * The one place every method above ends up, and what to call for a method
   * they do not cover.
   *
   * @param {string} method   the HTTP method
   * @param {string} url      the endpoint
   * @param {object} [data]   the query string for GET and DELETE, the body
   *   otherwise — `options.body` overrules that either way
   * @param {object} [options]
   *   `headers`  — added to the configured ones, and winning over them
   *   `signal`   — an AbortSignal, to call it off
   *   `timeout`  — ms before it is called off anyway
   *   `credentials` — as `fetch` takes it
   *   `body`     — true to send `data` as a body whatever the method, false to
   *                send it as a query string
   *   `raw`      — hand back the Response itself, unparsed and unchecked
   *   anything else is passed to `fetch` as it stands
   * @returns {Promise<*>} the parsed body, or the Response if `raw`.
   * @throws {RequestError} for any status outside 200–299.
   */
  static async send(method, url, data, options = {}) {
    if (typeof url !== "string" || url === "") {
      throw new TypeError(`Request.${method.toLowerCase()}() needs a URL`);
    }

    const { headers, signal, timeout, raw, body, ...rest } = options;
    const verb = method.toUpperCase();
    // A GET and a DELETE carry their data in the URL; everything else carries
    // it as a body. `body` in the options says so outright when a caller means
    // otherwise.
    const asBody = body ?? !["GET", "HEAD", "DELETE"].includes(verb);

    const target = resolve(asBody ? url : withQuery(url, data));
    const sending = asBody && !isEmpty(data);

    const init = {
      method: verb,
      credentials: options.credentials ?? defaults.credentials,
      ...rest,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        // Only when there is a body: a GET announcing that it is sending JSON
        // is announcing something untrue, and some servers act on it.
        ...(sending ? { "Content-Type": "application/json" } : {}),
        ...defaults.headers,
        ...headers,
      },
    };
    if (sending) {
      // A string is taken as already encoded — a caller who has done their own
      // serialising is not asking for it to be done again.
      init.body = typeof data === "string" ? data : JSON.stringify(data);
    }

    const abort = signalFor({ signal, timeout });
    if (abort) init.signal = abort;

    const response = await fetch(target, init);

    // Unparsed and unchecked: a caller asking for the response wants to read
    // the status and the headers itself.
    if (raw) return response;

    const answer = await bodyOf(response);
    if (!response.ok) throw new RequestError(response, answer);
    return answer;
  }
}

export default Request;
