// FileReader, ported from GWT.Commons
// (commons/file/client/FileReader.java, with FileReaderMode.java): asking the
// user for a file and reading what is in it.
//
//   const text = await FileReader.get().prompt(FileReaderMode.TEXT);
//   if (text !== null) this.document = text;
//
// A browser will only open a file chooser for a real click on a real
// `<input type="file">`, so there is one — hidden, made once, and clicked from
// code. That is the whole trick, and it is why this is a singleton in Java and
// stays one here: the input is reused, so a page that reads files does not
// accumulate them.
//
// Four of the six Java files were JSInterop declarations — `File`,
// `NativeFileReader`, `EventListener`, and the JSNI accessors that reached
// `event.target.result` and `event.target.files[0]`. They exist to describe the
// browser to Java. There is nothing to describe here, so they are gone, and
// what is left is the two classes that were doing the work.
//
// `AsyncCallback<String>` becomes a promise, as `Request` does it: what an
// `onSuccess` was for is what `await` is for.

/** What the file is read as — `FileReaderMode.java`, whose names these are. */
export const FileReaderMode = Object.freeze({
  /** The contents as text. */
  TEXT: "text",
  /** The contents as a `data:` URL, which is how a picture is read. */
  DATA_URL: "data_url",
});

export default class FileReader {
  /** The one instance, made when it is first asked for. */
  static INSTANCE = null;

  /**
   * The reader. There is one, and this is how to reach it — `FileReader.get()`
   * in Java, and the same here.
   */
  static get() {
    if (!FileReader.INSTANCE) FileReader.INSTANCE = new FileReader();
    return FileReader.INSTANCE;
  }

  constructor() {
    /**
     * The hidden input every prompt goes through.
     *
     * It is put in the document, which the Java version did not have to do —
     * `DOM.createElement` left it detached and clicked it anyway. Detached
     * inputs are clickable in every current browser too, but a chooser opened
     * from a node that is in no document has been a browser bug more than once,
     * and one line of appending is cheaper than finding out which.
     */
    this.input = document.createElement("input");
    this.input.type = "file";
    this.input.style.display = "none";
    document.body.appendChild(this.input);

    /** Whoever is waiting on the current prompt, and how they asked for it. */
    this.pending = null;
    this.mode = FileReaderMode.TEXT;

    this.input.addEventListener("change", () => this.handleChange());
    // The chooser was dismissed without a file. Java had no answer for this —
    // its callback was simply dropped and the caller heard nothing ever again,
    // which as a promise would be one that never settles. So a cancelled
    // prompt answers `null`, and that is what a caller checks for.
    this.input.addEventListener("cancel", () => this.settle(null));
  }

  /**
   * Ask for a file and read it.
   *
   * @param {string} mode One of {@link FileReaderMode}.
   * @param {object} [options]
   * @param {string} [options.accept] What kinds of file the chooser offers, as
   *   the `accept` attribute spells it: `".txt"`, `"image/*"`. Not in the Java
   *   version, which always offered everything; it is one attribute, and a
   *   chooser that offers everything when the application takes one kind of
   *   file is a worse chooser.
   * @returns {Promise<string|null>} What the file held, or null if the user
   *   chose nothing.
   */
  prompt(mode, { accept = "" } = {}) {
    // A second prompt while one is open. Java overwrote the callback and the
    // first caller was never told anything; here that would be a promise left
    // hanging for the life of the page, so the earlier one is answered first —
    // with null, because nothing was chosen for it.
    this.settle(null);

    this.mode = mode;
    this.input.accept = accept;

    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.input.click();
    });
  }

  /** A file was chosen: read it, in whichever way was asked for. */
  handleChange() {
    const file = this.input.files?.[0] ?? null;
    if (!file) {
      this.settle(null);
      return;
    }

    // The browser's own FileReader, which this class is named after and so
    // shadows: inside this module `FileReader` is the class below, and the one
    // being built here is the global.
    const reader = new globalThis.FileReader();
    reader.addEventListener("load", () => this.settle(reader.result));
    reader.addEventListener("error", () =>
      this.fail(reader.error ?? new Error("the file could not be read")),
    );

    if (this.mode === FileReaderMode.DATA_URL) reader.readAsDataURL(file);
    else reader.readAsText(file);
  }

  /**
   * Answer whoever is waiting, and put the input back to empty so that
   * choosing the same file twice running is heard twice — `input.setValue("")`
   * in Java, and the reason it is there.
   */
  settle(content) {
    const waiting = this.pending;
    this.pending = null;
    this.input.value = "";
    waiting?.resolve(content);
  }

  /** The same, for a file that could not be read. */
  fail(error) {
    const waiting = this.pending;
    this.pending = null;
    this.input.value = "";
    waiting?.reject(error);
  }
}
