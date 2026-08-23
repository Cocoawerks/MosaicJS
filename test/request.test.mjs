// Request: fetch with the JSON and the status checking done for the caller.
//
// `fetch` is stubbed rather than a server being started: what these check is
// what Request asks for and what it makes of the answer, and a real socket
// would only make that harder to see.
import assert from "node:assert/strict";
import test from "node:test";

import { Request, RequestError } from "../src/js/core/runtime/request.js";

/** Every call the stub took, newest last. */
let calls = [];

/**
 * Answer every request with `body`, and record what was asked.
 *
 * @param {*} body            what the server sends back
 * @param {object} [response] status, statusText and content type
 */
function answering(body, { status = 200, statusText = "OK", type } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const contentType =
    type ?? (typeof body === "string" ? "text/plain" : "application/json");

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      url: String(url),
      headers: { get: (name) => (/content-type/i.test(name) ? contentType : null) },
      text: async () => (body === undefined ? "" : text),
    };
  };
}

/** The one call that was made. */
const call = () => calls[calls.length - 1];

/** The headers it went out with. */
const sentHeaders = () => call().init.headers;

const realFetch = globalThis.fetch;
test.beforeEach(() => {
  calls = [];
  Request.reset();
});
test.after(() => {
  globalThis.fetch = realFetch;
});

// --- what comes back ----------------------------------------------------------

test("get resolves with the parsed body", async () => {
  answering({ id: 1, name: "Ada" });

  const user = await Request.get("/api/users/1");

  assert.deepEqual(user, { id: 1, name: "Ada" });
  assert.equal(call().url, "/api/users/1");
  assert.equal(call().init.method, "GET");
});

test("a body that is not JSON comes back as text", async () => {
  answering("plain words");
  assert.equal(await Request.get("/api/note"), "plain words");
});

test("a body the server calls JSON but is not comes back as text", async () => {
  answering("<html>error</html>", { type: "application/json" });
  assert.equal(await Request.get("/api/broken"), "<html>error</html>");
});

test("an empty body, and a 204, are both null", async () => {
  answering(undefined);
  assert.equal(await Request.get("/api/nothing"), null);

  answering({ ignored: true }, { status: 204, statusText: "No Content" });
  assert.equal(await Request.delete("/api/users/1"), null);
});

// --- what goes out ------------------------------------------------------------

test("post sends the data as a JSON body, and says so", async () => {
  answering({ id: 2 });

  await Request.post("/api/users", { name: "Grace" });

  assert.equal(call().init.method, "POST");
  assert.equal(call().init.body, '{"name":"Grace"}');
  assert.equal(sentHeaders()["Content-Type"], "application/json");
});

test("put and patch send a body too, and delete does not", async () => {
  answering({});

  await Request.put("/api/users/1", { name: "Ada" });
  assert.equal(call().init.method, "PUT");
  assert.equal(call().init.body, '{"name":"Ada"}');

  await Request.patch("/api/users/1", { name: "A" });
  assert.equal(call().init.method, "PATCH");
  assert.equal(call().init.body, '{"name":"A"}');

  await Request.delete("/api/users/1");
  assert.equal(call().init.method, "DELETE");
  assert.equal(call().init.body, undefined);
});

test("get puts its data in the query string, not in a body", async () => {
  answering([]);

  await Request.get("/api/notes", { tag: "one", limit: 10 });

  assert.equal(call().url, "/api/notes?tag=one&limit=10");
  assert.equal(call().init.body, undefined);
  assert.equal(
    sentHeaders()["Content-Type"],
    undefined,
    "nothing is being sent, so nothing is announced",
  );
});

test("a query joins what the URL already asks for", async () => {
  answering([]);
  await Request.get("/api/notes?page=2", { tag: "one" });
  assert.equal(call().url, "/api/notes?page=2&tag=one");
});

test("an array becomes the same key repeated, and nothing is sent as nothing", async () => {
  answering([]);
  await Request.get("/api/notes", { tag: ["a", "b"], since: null, q: undefined });
  assert.equal(call().url, "/api/notes?tag=a&tag=b");
});

test("delete takes a query string as well", async () => {
  answering(null);
  await Request.delete("/api/notes", { before: "2026-01-01" });
  assert.equal(call().url, "/api/notes?before=2026-01-01");
});

test("a string body is taken as already encoded", async () => {
  answering({});
  await Request.post("/api/raw", '{"already":"json"}');
  assert.equal(call().init.body, '{"already":"json"}');
});

// --- a refusal ----------------------------------------------------------------

test("a status outside 200-299 throws, carrying the status and the body", async () => {
  answering({ error: "no such user" }, { status: 404, statusText: "Not Found" });

  const thrown = await Request.get("/api/users/9").then(
    () => null,
    (e) => e,
  );

  assert.ok(thrown instanceof RequestError);
  assert.equal(thrown.status, 404);
  assert.equal(thrown.statusText, "Not Found");
  assert.equal(thrown.url, "/api/users/9");
  assert.deepEqual(thrown.body, { error: "no such user" });
  assert.match(thrown.message, /404 Not Found/);
  assert.match(thrown.message, /no such user/, "the server's own words");
});

test("and an error page's text is kept rather than thrown away", async () => {
  answering("the database is on fire", {
    status: 500,
    statusText: "Internal Server Error",
  });

  const thrown = await Request.post("/api/users", {}).then(
    () => null,
    (e) => e,
  );

  assert.equal(thrown.status, 500);
  assert.equal(thrown.body, "the database is on fire");
  assert.match(thrown.message, /the database is on fire/);
});

test("`raw` hands back the response itself, refusal and all", async () => {
  answering({ error: "nope" }, { status: 403, statusText: "Forbidden" });

  const response = await Request.get("/api/secret", null, { raw: true });

  assert.equal(response.status, 403, "nothing was thrown");
  assert.equal(response.ok, false);
});

// --- configuration ------------------------------------------------------------

test("a base URL is put in front of a path, and left off a full URL", async () => {
  answering({});
  Request.configure({ baseUrl: "https://api.example.com/" });

  await Request.get("/users");
  assert.equal(call().url, "https://api.example.com/users");

  await Request.get("users");
  assert.equal(call().url, "https://api.example.com/users");

  await Request.get("https://elsewhere.test/users");
  assert.equal(call().url, "https://elsewhere.test/users", "left alone");
});

test("configured headers ride along, and a call's own win", async () => {
  answering({});
  Request.configure({ headers: { Authorization: "Bearer abc", "X-App": "one" } });

  await Request.get("/api/me", null, { headers: { "X-App": "two" } });

  assert.equal(sentHeaders().Authorization, "Bearer abc");
  assert.equal(sentHeaders()["X-App"], "two");
});

test("a header set to nothing is taken off again", async () => {
  answering({});
  Request.configure({ headers: { Authorization: "Bearer abc" } });
  await Request.get("/api/me");
  assert.equal(sentHeaders().Authorization, "Bearer abc");

  Request.configure({ headers: { Authorization: null } });
  await Request.get("/api/me");
  assert.equal(sentHeaders().Authorization, undefined, "logged out");
});

test("reset forgets everything configured", async () => {
  answering({});
  Request.configure({ baseUrl: "https://a.test", headers: { A: "1" } });
  Request.reset();

  await Request.get("/api/me");
  assert.equal(call().url, "/api/me");
  assert.equal(sentHeaders().A, undefined);
});

test("configure merges rather than replaces, and settings reads back", () => {
  Request.configure({ baseUrl: "https://a.test" });
  Request.configure({ headers: { A: "1" } });
  Request.configure({ headers: { B: "2" } });

  const settings = Request.settings;
  assert.equal(settings.baseUrl, "https://a.test");
  assert.deepEqual(settings.headers, { A: "1", B: "2" });

  settings.headers.C = "3";
  assert.equal(Request.settings.headers.C, undefined, "a copy, not the thing");
});

// --- calling it off -----------------------------------------------------------

test("a signal is passed through, and aborting rejects", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });

  const pending = Request.get("/api/slow", null, { signal: controller.signal });
  controller.abort();

  const thrown = await pending.then(
    () => null,
    (e) => e,
  );
  assert.equal(thrown.name, "AbortError");
});

// --- refusals that are the caller's fault -------------------------------------

test("a request with no URL is refused rather than sent", async () => {
  answering({});
  await assert.rejects(() => Request.get(""), TypeError);
  await assert.rejects(() => Request.post(null, {}), TypeError);
  assert.equal(calls.length, 0, "nothing was sent");
});
