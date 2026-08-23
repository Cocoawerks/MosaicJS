/**
 * The controller behind `main.ib.xml`, and the client half of the example.
 *
 * Everything it knows about talking to a back end is the first two lines. There
 * is no URL, no `fetch`, no JSON to stringify, no status to check, and nothing
 * that says which host is answering — the same file runs under `mosaic web`,
 * where the calls go over HTTP, and under `mosaic desktop`, where they go over
 * the window's own bridge.
 */
import { rpc, Rpc, RpcError } from "mosaic/frameworks/rpc";
import { setTheme, theme } from "mosaic/frameworks/ui";

/**
 * The client. Made once at module level and kept: there is no connection
 * behind it and nothing to close, so it is a constant rather than something a
 * controller has to build.
 *
 * `api.notes.list` is not a function anyone wrote. Reading `notes` and then
 * `list` names the call, and calling it sends it — so a function a service
 * exports is callable the moment it is written, with nothing to declare here.
 */
const api = rpc();

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "RpcApp";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "calling notes.list()…";

    /** @type {Array<object>} What `notes.list()` last returned. */
    this.notes = [];

    /** @type {string} The notes as the list shows them. */
    this.lines = "";

    /** @type {string} What a refused call said, and what it said about it. */
    this.refused = "";

    /** @type {string} Which host answered, and how. */
    this.host = "asking…";

    /** @type {string} What the process on the other side is. */
    this.about = "";

    /** @type {boolean} Whether a call is in flight — the buttons read it. */
    this.idle = true;

    /** @type {string} What the slow call last counted. */
    this.counted = "";

    /** @type {string} Where the last file went, in the page's own words. */
    this.wrote = "";

    /** @type {string} What was read back out of it. */
    this.fileText = "";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;

    /**
     * @type {string} A button's label, held here rather than written in the
     * markup: a `{…}` there is a binding, which is exactly what this spells.
     */
    this.filterCall = "notes.list({ done: true })";
  }

  /**
   * On the page: fetch what there is.
   *
   * An ordinary `async` method. Awaiting a call and assigning what comes back
   * is the whole of it — assigning is what redraws, so there is no other step
   * between a server's answer and the page showing it.
   */
  async attached() {
    await this.reload();
    await this.askWhere();
  }

  // --- reading -------------------------------------------------------------

  /** Every note. The plainest call there is: one name, no arguments. */
  async reload() {
    await this.during(async () => {
      this.notes = await api.notes.list();
      this.show(`notes.list() → ${this.notes.length} notes`);
    });
  }

  /**
   * The same call with an argument. Arguments cross as JSON, so what a service
   * takes is plain data — this one takes an object and filters by it.
   */
  async showDone() {
    await this.during(async () => {
      this.notes = await api.notes.list({ done: true });
      this.show(`notes.list({ done: true }) → ${this.notes.length} notes`);
    });
  }

  /**
   * Two services, and the second one is a second file. `system.js` beside
   * `notes.js` is the whole of what made `api.system.*` callable.
   */
  async askWhere() {
    const where = await api.system.where();
    this.host = `${where.host} — ${where.detail}`;

    const about = await api.system.about();
    this.about = `bun ${about.bun} · ${about.platform} · pid ${about.pid} · ${about.cwd}`;
  }

  // --- writing -------------------------------------------------------------

  /**
   * Add one, and show what the service refused if it refused.
   *
   * The service checks the title rather than this method doing it, which is
   * the point of having a back end: a page can be lied to. What comes back is
   * an {@link RpcError} carrying the service's own message and whatever it
   * attached — `data.field` here, which is how a form knows what to mark.
   */
  async add() {
    this.refused = "";
    await this.during(async () => {
      try {
        const made = await api.notes.create({ title: this.titleField.value });
        this.titleField.value = "";
        this.notes = await api.notes.list();
        this.show(`notes.create(…) → note ${made.id}, "${made.title}"`);
      } catch (e) {
        if (!(e instanceof RpcError)) throw e;
        this.refused = `${e.remoteName}: ${e.message} — data ${JSON.stringify(e.data)}`;
        this.show(`notes.create({ title: "" }) was refused`);
      }
    });
  }

  /** Tick the first note off, or un-tick it. */
  async toggleFirst() {
    const first = this.notes[0];
    if (!first) return this.show("nothing to tick off");

    await this.during(async () => {
      const note = await api.notes.setDone({ id: first.id, done: !first.done });
      this.notes = await api.notes.list();
      this.show(`notes.setDone(…) → "${note.title}" is ${note.done ? "done" : "not done"}`);
    });
  }

  /** Remove the last one. A service returning nothing answers with null. */
  async removeLast() {
    const last = this.notes[this.notes.length - 1];
    if (!last) return this.show("nothing to remove");

    await this.during(async () => {
      const answer = await api.notes.remove(last.id);
      this.notes = await api.notes.list();
      this.show(`notes.remove(${last.id}) → ${JSON.stringify(answer)}`);
    });
  }

  // --- doing something a page cannot ---------------------------------------

  /**
   * Ask the service to write "Hello World" to a file, then read it back.
   *
   * The reading back is not ceremony: it is the difference between a service
   * that says it wrote a file and a file that is there. Note what this method
   * does *not* have — no path, no permission, no file system. It has a name and
   * an `await`, and the machinery on the other side did the only part a page is
   * not allowed to do.
   */
  async writeHello() {
    this.refused = "";
    await this.during(async () => {
      const made = await api.files.writeHello();
      this.wrote = `files.writeHello() → ${made.bytes} bytes at ${made.path}`;
      this.fileText = await api.files.read(made.path);
      this.show(`wrote ${made.path}`);
    });
  }

  // --- what a call is, and what it is not ----------------------------------

  /**
   * A slow one. Nothing here says "loading" — the flag this sets is read by
   * the buttons' `enabled` in the markup, and awaiting is all this does.
   */
  async count() {
    await this.during(async () => {
      this.counted = `notes.slowCount() → ${await api.notes.slowCount()} (it waited 1.2s)`;
    });
  }

  /**
   * A method that does not exist. Worth showing rather than hiding: names are
   * checked when the call is made, not when the page is built, which is the
   * price of writing `api.notes.list()` instead of a generated stub.
   */
  async callMissing() {
    this.refused = "";
    try {
      await api.notes.thisIsNotAMethod();
    } catch (e) {
      this.refused = `${e.remoteName}: ${e.message}`;
      this.show("a name that is not a method is refused, not guessed at");
    }
  }

  /** And a service that fails on purpose, which is not the caller's fault. */
  async callFailing() {
    this.refused = "";
    try {
      await api.system.fail();
    } catch (e) {
      this.refused = `${e.remoteName}: ${e.message}`;
      this.show("what a service throwing looks like from here");
    }
  }

  /** What the client settled on, without being told. */
  get wire() {
    return Rpc.onDesktop ? "the desktop bridge" : `POST ${Rpc.settings.url}`;
  }

  // --- the page's own bookkeeping ------------------------------------------

  /**
   * Run a call with the page marked busy for as long as it takes. The `finally`
   * matters: a call that fails must still give the buttons back.
   */
  async during(work) {
    this.idle = false;
    try {
      await work();
    } catch (e) {
      this.refused = String(e.message ?? e);
      this.show("the call failed");
    } finally {
      this.idle = true;
    }
  }

  /** Say what just happened, and redraw the list. */
  show(said) {
    this.note = said;
    this.lines = this.notes
      .map((n) => `${n.done ? "×" : "·"} ${String(n.id).padStart(2)}  ${n.title}`)
      .join("\n");
  }

  // --- the theme ------------------------------------------------------------

  /**
   * @param {object} combo The ComboBox that fired.
   * @param {string} value The theme chosen.
   */
  themeChanged(combo, value) {
    this.theme = setTheme(value);
    this.note = `theme: ${value}`;
  }
}
