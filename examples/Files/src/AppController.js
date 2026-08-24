// The page's controller: a notepad, which is the smallest thing that needs
// both halves of the file module.
//
// Everything about reading and writing files is four lines of this file. The
// rest is a text area and a status line, because that is all a notepad is.
import { FileReader, FileReaderMode, FileWriter } from "mosaic/frameworks/ui";

export default class AppController {
  constructor() {
    /**
     * What the status line says.
     *
     * Plain state rather than a getter over `message` and `count`, because a
     * `{binding}` is re-read when something the controller holds is assigned —
     * and a getter with nothing assigned behind it is read once and never
     * again. Written as a derived getter, this line lagged an action behind:
     * it came right only when the picture changed, because the picture is the
     * other thing on this controller that a binding names.
     */
    this.status = "Nothing open yet.";

    /** The last thing that happened, which `say` turns into the line above. */
    this.message = this.status;

    /** The picture, once one has been opened, as the `data:` URL it was read as. */
    this.image = "";

    /** How many characters are in the editor, for the status line. */
    this.count = 0;
  }

  /**
   * Open a text file.
   *
   * `prompt` answers null when the user closes the chooser without picking
   * anything — the case the Java original had no answer for — so that is the
   * first thing this checks, and the only thing that makes this method longer
   * than one line.
   */
  async open() {
    const text = await FileReader.get().prompt(FileReaderMode.TEXT, {
      accept: ".txt,.md,.json,text/*",
    });

    if (text === null) {
      this.say("Nothing opened — the chooser was closed.");
      return;
    }

    this.editor.value = text;
    // The count comes from the editor, and `say` appends it — so this says
    // what happened and leaves the arithmetic to the one place doing it.
    this.edited();
    this.say("Opened a file.");
  }

  /**
   * Open a picture, which is the same call with the other mode: read as a
   * `data:` URL, the contents can be put straight in an `<img>`.
   */
  async openImage() {
    const url = await FileReader.get().prompt(FileReaderMode.DATA_URL, {
      accept: "image/*",
    });

    if (url === null) {
      this.say("No picture opened.");
      return;
    }

    this.image = url;
    this.say(`Opened a picture — ${Math.round(url.length / 1024)} KB as a data URL.`);
  }

  /** Hand the text back to the user as a file. */
  async save() {
    const name = this.nameField.value.trim() || "untitled.txt";
    await FileWriter.get().run(this.editor.value, name);

    // "Started", not "saved": a click begins a download and the page is never
    // told how it went. The writer says as much, and so does this.
    this.say(`Saving as ${name}…`);
  }

  /** Put the picture away again. */
  clearImage() {
    this.image = "";
    this.say("Picture closed.");
  }

  /** Every keystroke in the editor, so the count in the status line follows. */
  edited() {
    this.count = this.editor.value.length;
    this.say(this.message);
  }

  /**
   * Say what just happened, with the character count when there is anything to
   * count. Assigning `status` is what puts the line on the page.
   */
  say(message) {
    this.message = message;
    this.status =
      this.count > 0
        ? `${message} ${this.count.toLocaleString()} characters.`
        : message;
  }

  /**
   * Whether there is a picture to show — what the preview's class binds to.
   *
   * A getter is safe here, unlike the status line: `image` is assigned *and*
   * named by a binding of its own, so every assignment refreshes the page and
   * this is re-read along with it.
   */
  get previewState() {
    return this.image ? "shown" : "";
  }
}
