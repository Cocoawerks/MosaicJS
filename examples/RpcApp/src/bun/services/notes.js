// A service: the application's own back end, and half of what this example is.
//
// It runs where the privileges are — in `mosaic web`'s process, or in the
// Electrobun main process when the same application is run as a desktop app —
// and the page reaches it by name. Nothing here is bundled into the page: the
// compiler skips `bun/`, so a service may open a database, read the disk, or
// hold a key, and none of it crosses.
//
// What makes this file an API is where it sits. A module in `bun/services/` is
// a service, and its file name is the group a page calls it by: this one
// answers `api.notes.*`. There is no registration anywhere, and no route table
// — exporting a function is the whole of publishing it.
//
// The state below is a Map because an example should be readable. A real one
// would open `bun:sqlite` here, and nothing else about the file would change.

/** The notes, by id. This is the whole database. */
const notes = new Map([
  [1, { id: 1, title: "Buy milk", done: false }],
  [2, { id: 2, title: "Write the RPC example", done: true }],
]);

let nextId = 3;

/** Waiting, so the page has something slow to show a spinner for. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  /**
   * Every note. Arguments and results cross as JSON, so what a service takes
   * and returns is plain data — an object, an array, a number.
   *
   * @param {{done?: boolean}} [filter] What to keep, if anything.
   */
  async list(filter = {}) {
    const all = [...notes.values()];
    if (filter.done === undefined) return all;
    return all.filter((note) => note.done === filter.done);
  },

  /**
   * Add one.
   *
   * The check is here rather than in the page, which is the point of having a
   * back end at all: a page can be lied to, and this cannot be got around by
   * calling the service directly. What is thrown arrives at the call site as a
   * rejected promise, so the page's `catch` is where it surfaces — and `data`
   * rides along, which is how a form knows which field to mark.
   */
  async create({ title } = {}) {
    if (!title || !title.trim()) {
      const refused = new Error("a note needs a title");
      refused.data = { field: "title" };
      throw refused;
    }
    console.log("Calling create RPC!!")
    const made = { id: nextId++, title: title.trim(), done: false };
    notes.set(made.id, made);
    return made;
  },

  /** Tick one off, or un-tick it. Returns the note as it now stands. */
  async setDone({ id, done }) {
    const note = notes.get(Number(id));
    if (!note) {
      const missing = new Error(`no note ${id}`);
      missing.data = { id };
      throw missing;
    }
    note.done = !!done;
    return note;
  },

  /** Remove one. Nothing to return, which the page receives as null. */
  async remove(id) {
    notes.delete(Number(id));
  },

  /**
   * Something slow, so the example has one call worth waiting for. A page
   * awaiting this is an ordinary `await` — the button it disables while the
   * call is in flight is the whole of what "loading" means here.
   */
  async slowCount() {
    await pause(1200);
    return notes.size;
  },
};
