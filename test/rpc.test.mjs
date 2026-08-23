// RPC: a page calling the application's own services.
//
// Three things are checked here, in the order they matter. The dispatcher,
// which both hosts run and which decides what is callable at all. The client,
// which turns `api.notes.list(…)` into one message. And the two together,
// through a real HTTP server, which is what `mosaic web` puts them behind.
import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatch,
  methodFor,
  methodsOf,
} from "../src/js/frameworks/rpc/dispatch.js";
import { rpc, Rpc, RpcError } from "../src/js/frameworks/rpc/client.js";

/** Services to answer with, as an application's `bun/services/` would. */
const services = {
  notes: {
    async list({ tag } = {}) {
      return tag ? [{ id: 1, tag }] : [{ id: 1 }, { id: 2 }];
    },
    async create(note) {
      if (!note?.title) {
        const e = new Error("a note needs a title");
        e.data = { field: "title" };
        throw e;
      }
      return { id: 3, ...note };
    },
    async remove() {},
    /** Not a function, so not a method. */
    version: "1.0",
  },
  /** A service that wants to know who is asking. */
  session: {
    async who() {
      return this.context?.who ?? "nobody";
    },
  },
};

// --- the dispatcher -----------------------------------------------------------

test("a call reaches the function its name stands for", async () => {
  const answer = await dispatch(
    { id: 7, method: "notes.list", params: [{ tag: "one" }] },
    services,
  );
  assert.deepEqual(answer, { id: 7, value: [{ id: 1, tag: "one" }] });
});

test("a method that returns nothing answers with null, not with undefined", async () => {
  // `undefined` is not JSON, and a caller awaiting a delete should get an
  // answer rather than a hole.
  const answer = await dispatch({ method: "notes.remove", params: [1] }, services);
  assert.deepEqual(answer, { id: null, value: null });
});

test("a service that throws comes back as an error, not as an exception", async () => {
  const answer = await dispatch({ method: "notes.create", params: [{}] }, services);

  assert.equal(answer.value, undefined);
  assert.equal(answer.error.message, "a note needs a title");
  assert.deepEqual(answer.error.data, { field: "title" });
  assert.equal("stack" in answer.error, false, "the server's paths stay there");
});

test("a name that is not a method is refused rather than guessed at", async () => {
  for (const method of [
    "notes.missing",
    "missing.list",
    "notes.version",
    "notes",
    "notes.list.extra",
    "",
    null,
  ]) {
    const answer = await dispatch({ method }, services);
    assert.equal(answer.error?.name, "NoSuchMethod", `for ${method}`);
  }
});

test("and nothing off the prototype chain is callable", async () => {
  // The reason a dotted name is a group and a function rather than a path to
  // walk: `constructor`, `toString` and `__proto__` are properties of every
  // object alive, and none of them is a service.
  for (const method of [
    "notes.constructor",
    "notes.toString",
    "notes.hasOwnProperty",
    "constructor.name",
    "__proto__.x",
    "notes.__proto__",
  ]) {
    assert.equal(methodFor(services, method), null, `for ${method}`);
    const answer = await dispatch({ method, params: [] }, services);
    assert.equal(answer.error?.name, "NoSuchMethod", `for ${method}`);
  }
});

test("a service can read the context the host gave it", async () => {
  const answer = await dispatch({ method: "session.who" }, services, { who: "ada" });
  assert.equal(answer.value, "ada");
});

test("methodsOf lists what is callable, and nothing else", () => {
  assert.deepEqual(methodsOf(services), [
    "notes.create",
    "notes.list",
    "notes.remove",
    "session.who",
  ]);
});

// --- the client ---------------------------------------------------------------

/** A client wired straight to the dispatcher, with no wire in between. */
function local(context = null) {
  const sent = [];
  const api = rpc({
    transport: {
      async send(message) {
        sent.push(message);
        return dispatch(message, services, context);
      },
    },
  });
  return { api, sent };
}

test("a property path becomes a method name, and calling it sends one message", async () => {
  const { api, sent } = local();

  const notes = await api.notes.list({ tag: "one" });

  assert.deepEqual(notes, [{ id: 1, tag: "one" }]);
  assert.deepEqual(sent, [{ method: "notes.list", params: [{ tag: "one" }] }]);
});

test("a service's error arrives as a rejected promise, where the call was made", async () => {
  const { api } = local();

  const thrown = await api.notes.create({}).then(
    () => null,
    (e) => e,
  );

  assert.ok(thrown instanceof RpcError);
  assert.equal(thrown.message, "a note needs a title");
  assert.equal(thrown.method, "notes.create");
  assert.deepEqual(thrown.data, { field: "title" });
});

test("a name that is not group.name is refused before anything is sent", async () => {
  const { api, sent } = local();

  await assert.rejects(() => api.notes(), /group.name/);
  await assert.rejects(() => api.a.b.c(), /group.name/);
  assert.equal(sent.length, 0, "nothing went out");
});

test("the proxy is not mistaken for a promise", async () => {
  // Awaiting a proxy that answered `then` with a function would hang for ever,
  // waiting on a call nobody made.
  const { api } = local();
  assert.equal(api.notes.then, undefined);
  assert.equal(await Promise.resolve(api.notes.list).then(() => "settled"), "settled");
});

test("an answer that is not an envelope is refused", async () => {
  const api = rpc({ transport: { send: async () => ({ nonsense: true }) } });
  await assert.rejects(() => api.notes.list(), /not an rpc reply/);
});

// --- both halves, over HTTP ---------------------------------------------------

test("a call travels over HTTP and comes back, error and all", async (t) => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/rpc") {
        return new Response("not found", { status: 404 });
      }
      // What `mosaic web` does, in the three lines it does it in.
      const message = await request.json();
      return Response.json(await dispatch(message, services, { request }));
    },
  });
  t.after(() => server.stop(true));

  Rpc.configure({ url: `http://localhost:${server.port}/rpc` });
  t.after(() => Rpc.reset());

  const api = rpc();

  assert.deepEqual(await api.notes.list(), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(await api.notes.create({ title: "One" }), { id: 3, title: "One" });
  assert.equal(await api.notes.remove(1), null);

  const thrown = await api.notes.create({}).then(
    () => null,
    (e) => e,
  );
  assert.ok(thrown instanceof RpcError, "the service's refusal, not the request's");
  assert.equal(thrown.message, "a note needs a title");
  assert.deepEqual(thrown.data, { field: "title" });
});
