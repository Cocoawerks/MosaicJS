// FileWriter: handing the user a file to save.
//
//   await FileWriter.get().run(JSON.stringify(doc), "puzzle.json");
//
// The counterpart to {@link FileReader}, and the same trick from the other end:
// a browser saves a file when a link carrying `download` is clicked, so there
// is a hidden anchor, made once and clicked from code.

import { encodeText } from "./encode.js";

export default class FileWriter {
  /** The one instance, made when it is first asked for. */
  static INSTANCE = null;

  /** The writer. `FileWriter.get()` in Java, and the same here. */
  static get() {
    if (!FileWriter.INSTANCE) FileWriter.INSTANCE = new FileWriter();
    return FileWriter.INSTANCE;
  }

  constructor() {
    this.anchor = document.createElement("a");
    this.anchor.style.display = "none";
    document.body.appendChild(this.anchor);
  }

  /**
   * Hand the user a file.
   *
   * @param {string} text What goes in it.
   * @param {string} name What it is called when it lands.
   * @param {string} [type] Its MIME type. The Java version wrote every file as
   *   `text/plain`; a JSON document saved as plain text is one the operating
   *   system then does not know what to do with, and this is the one string
   *   that fixes it.
   * @returns {Promise<void>} Settled once the download has been started.
   */
  async run(text, name, type = "text/plain;charset=utf-8") {
    const url = encodeText(text, type);

    this.anchor.href = url;
    this.anchor.download = name;
    this.anchor.click();

    // What a `data:` URL costs is its own length: the whole file is encoded
    // into the address, and browsers cap how long one may be — a few megabytes,
    // and less on some. A blob URL is a handle instead, so a large document
    // saves rather than silently failing. It has to be given back afterwards,
    // which is what the timeout is for: revoking it while the download is still
    // starting cancels the download.
    if (url.startsWith("blob:")) {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    // Java called `onContentWritten()` on the line after the click and called
    // that success. It is not: a click starts a download, and nothing in the
    // page is told how it went — the user may still cancel it, and a disk may
    // still be full. So this settles to say the download was *started*, which
    // is the most that can honestly be claimed, and is what the Java callback
    // was really reporting.
  }
}
