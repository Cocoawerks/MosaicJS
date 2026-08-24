// FileReader and FileWriter, ported from GWT.Commons (commons/file/client).
// Build first: `mosaic compile examples/Counter_component --keep-modules` —
// these tests import the compiled modules themselves, which a plain compile
// prunes once they are in the bundle.
//
// Neither class can open a chooser or save a file here, and neither is what is
// checked. What is checked is everything around that: which mode was asked
// for, what a cancelled prompt answers, what a second prompt does to the first,
// and that the input is left empty so the same file chosen twice is heard
// twice.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { FileReader, FileReaderMode, FileWriter, encodeText } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/**
 * The browser's FileReader, which the class under test is named after and
 * reaches for as a global. This one reads nothing: it hands back whatever the
 * test said the file holds, when the test says so.
 */
function stubNativeReader() {
  const reads = [];

  globalThis.FileReader = class {
    constructor() {
      this.listeners = {};
      reads.push(this);
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    readAsText() {
      this.mode = "text";
    }
    readAsDataURL() {
      this.mode = "data_url";
    }
    /** Finish the read, as the browser would. */
    load(result) {
      this.result = result;
      this.listeners.load?.();
    }
    /** Or fail it. */
    fail(error) {
      this.error = error;
      this.listeners.error?.();
    }
  };

  return reads;
}

/**
 * A reader with its input rigged: clicking it chooses `file`, as a user would,
 * or chooses nothing and dismisses the chooser.
 */
function riggedReader({ file = { name: "notes.txt" }, cancel = false } = {}) {
  const reader = new FileReader();
  const { input } = reader;
  const clicks = [];

  input.click = () => {
    clicks.push(input.accept);
    if (cancel) {
      input.dispatchEvent({ type: "cancel" });
      return;
    }
    input.files = file ? [file] : [];
    input.dispatchEvent({ type: "change" });
  };

  return { reader, input, clicks };
}

// ------------------------------------------------------------- reading ---

test("a prompt resolves with what the file held", async () => {
  const reads = stubNativeReader();
  const { reader } = riggedReader();

  const waiting = reader.prompt(FileReaderMode.TEXT);
  reads[0].load("the contents");

  assert.equal(await waiting, "the contents");
});

test("the mode decides how the file is read", async () => {
  const reads = stubNativeReader();
  const { reader } = riggedReader();

  const asText = reader.prompt(FileReaderMode.TEXT);
  reads[0].load("x");
  await asText;
  assert.equal(reads[0].mode, "text");

  const asUrl = reader.prompt(FileReaderMode.DATA_URL);
  reads[1].load("data:,x");
  await asUrl;
  assert.equal(reads[1].mode, "data_url");
});

test("a dismissed chooser answers null rather than never answering", async () => {
  stubNativeReader();
  const { reader } = riggedReader({ cancel: true });

  // The Java version dropped its callback here and the caller heard nothing
  // ever again. As a promise that is one that never settles, so this is the
  // difference that matters most in the port.
  assert.equal(await reader.prompt(FileReaderMode.TEXT), null);
});

test("a chooser closed with no file chosen answers null too", async () => {
  stubNativeReader();
  const { reader } = riggedReader({ file: null });

  assert.equal(await reader.prompt(FileReaderMode.TEXT), null);
});

test("a second prompt answers the first rather than leaving it hanging", async () => {
  const reads = stubNativeReader();
  const { reader, input } = riggedReader();
  // A prompt that opens the chooser and waits, rather than answering at once.
  input.click = () => {};

  const first = reader.prompt(FileReaderMode.TEXT);
  const second = reader.prompt(FileReaderMode.TEXT);

  assert.equal(await first, null);
  assert.equal(reads.length, 0, "nothing was read for either yet");
  assert.ok(second instanceof Promise);
});

test("the input is emptied, so the same file twice is heard twice", async () => {
  const reads = stubNativeReader();
  const { reader, input } = riggedReader();

  const first = reader.prompt(FileReaderMode.TEXT);
  reads[0].load("once");
  await first;

  assert.equal(input.value, "", "input.setValue(\"\") in Java, and why");

  const again = reader.prompt(FileReaderMode.TEXT);
  reads[1].load("twice");
  assert.equal(await again, "twice");
});

test("a file that cannot be read rejects", async () => {
  const reads = stubNativeReader();
  const { reader } = riggedReader();

  const waiting = reader.prompt(FileReaderMode.TEXT);
  reads[0].fail(new Error("unreadable"));

  await assert.rejects(waiting, /unreadable/);
});

test("accept narrows what the chooser offers", async () => {
  const reads = stubNativeReader();
  const { reader, clicks } = riggedReader();

  const waiting = reader.prompt(FileReaderMode.TEXT, { accept: ".txt" });
  reads[0].load("x");
  await waiting;

  assert.deepEqual(clicks, [".txt"]);
});

test("there is one reader, and get() is how it is reached", () => {
  assert.equal(FileReader.get(), FileReader.get());
});

// ------------------------------------------------------------- writing ---

/** Run `body` with no Blob to be had, which is the fallback's whole condition. */
function withoutBlob(body) {
  const blob = globalThis.Blob;
  globalThis.Blob = undefined;
  try {
    return body();
  } finally {
    globalThis.Blob = blob;
  }
}

test("a save names the file, points the anchor at it and clicks it", async () => {
  const writer = new FileWriter();
  const clicks = [];
  writer.anchor.click = () =>
    clicks.push([writer.anchor.href, writer.anchor.download]);

  await writer.run("hello", "greeting.txt");

  assert.equal(clicks.length, 1);
  const [href, name] = clicks[0];
  assert.equal(name, "greeting.txt");
  assert.match(href, /^blob:/);
});

test("the contents and MIME type reach the blob", async () => {
  const writer = new FileWriter();
  let href = "";
  writer.anchor.click = () => (href = writer.anchor.href);

  await writer.run("{\"a\": 1}", "doc.json", "application/json");

  // A blob URL is a handle, so the only way to see what is behind it is to
  // fetch it — which is also the proof that the file would arrive intact.
  const saved = await fetch(href);
  assert.match(saved.headers.get("content-type"), /^application\/json/);
  assert.equal(await saved.text(), "{\"a\": 1}");
});

test("encodeText prefers a blob URL, which has no length limit", () => {
  assert.match(encodeText("big", "text/plain"), /^blob:/);
});

test("encodeText falls back to the data URL Java built where blobs are absent", () => {
  withoutBlob(() => {
    assert.equal(
      encodeText("a b&c", "text/plain;charset=utf-8"),
      "data:text/plain;charset=utf-8,a%20b%26c",
    );
  });
});

test("a data URL is not revoked, having nothing to give back", async () => {
  const writer = new FileWriter();
  let href = "";
  writer.anchor.click = () => (href = writer.anchor.href);

  await withoutBlob(() => writer.run("plain", "note.txt"));

  assert.match(href, /^data:text\/plain;charset=utf-8,plain$/);
});

test("there is one writer too", () => {
  assert.equal(FileWriter.get(), FileWriter.get());
});
