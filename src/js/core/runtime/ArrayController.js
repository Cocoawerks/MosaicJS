// ArrayController: a bindable wrapper around an ordinary array.
//
// It is what Cocoa calls an NSArrayController, pared to its heart: a JavaScript
// array lives behind it, and two properties of the controller can be bound to —
//
//   objects   the array itself, in order.
//   count     how many items are in it.
//
// The array is never handed out to be mutated behind the controller's back;
// items are added and removed through the controller's own methods, and each
// such change tells whatever is bound to `objects` and to `count` to read them
// again. So a label bound to `count` follows the size of the list, and a list
// view drawn from `objects` redraws as items come and go, without either being
// wired to the other.
//
//   const people = new ArrayController();
//   bind(people, "count", this.countLabel, "text", (n) => `${n} people`);
//   people.add(new Person("Ada"));   // the label now reads "1 people"
//
// A view drawing `controller.objects` picks the change up the same way every
// other read does: the array is replaced rather than mutated in place, so the
// property a drawing depended on is seen to be assigned.
import {notify} from "./private/observe.js";
import {Request} from "./request.js";

export class ArrayController {
    /**
     * @param {Iterable<*>} [content] What it starts out holding. Copied, so the
     *   caller's own array is not adopted and later surprised by the controller
     *   changing under it.
     * @param {object} [options]
     * @param {string} [options.url]    An endpoint that returns a JSON array;
     *   `sync()` fetches it and becomes it. Bound after construction with
     *   `controller.url = …`.
     * @param {string} [options.method] The HTTP verb `sync()` uses — "get" by
     *   default; "post" (etc.) for an endpoint that requires a CSRF-guarded write.
     */
    constructor(content = [], options = {}) {
        /**
         * The items, in order. Held in a field of its own and replaced whole on
         * every change — reading `objects` hands this out, and a drawing that read
         * it has to see a fresh value to know it moved. @private
         */
        this._objects = [...content];

        /** The endpoint `sync()` reads, or null when the list is filled by hand. */
        this._url = options.url ?? null;
        /** The verb `sync()` uses (lower-case, as `Request`'s method names are). */
        this._method = (options.method ?? "get").toLowerCase();
        /** Bumped per `sync()` so a slow response that a newer one outran is dropped. */
        this._syncSeq = 0;
    }

    /** @public The endpoint `sync()` reads. */
    get url() {
        return this._url;
    }

    set url(url) {
        this._url = url ?? null;
    }

    // --- the bindable properties ---------------------------------------------

    /**
     * @public The items, in order. Read-only through this property: the array is
     * the controller's to change, through `add`, `remove`, and the rest. What
     * comes back is the live array — treat it as a snapshot and do not mutate it,
     * or the controller will not know it changed.
     */
    get objects() {
        return this._objects;
    }

    /** @public How many items there are. */
    get count() {
        return this._objects.length;
    }

    // --- reading -------------------------------------------------------------

    /**
     * @public The item at `index`, or `undefined` when there is none there. A
     * negative index counts from the end, as `Array.prototype.at` does.
     */
    at(index) {
        return this._objects.at(index);
    }

    /** @public Where `object` first sits, or -1 when it is not there. */
    indexOf(object) {
        return this._objects.indexOf(object);
    }

    /** @public Whether `object` is in the array. */
    contains(object) {
        return this._objects.includes(object);
    }

    /** @public Whether there is nothing in it. */
    get isEmpty() {
        return this._objects.length === 0;
    }

    /** @public Iterate the items, so `for (const x of controller)` works. */
    [Symbol.iterator]() {
        return this._objects[Symbol.iterator]();
    }

    // --- changing ------------------------------------------------------------

    /**
     * @public Replace everything with `content`. Copied, like the constructor's.
     */
    setContent(content = []) {
        this._change([...content]);
    }

    /**
     * @public Fetch the array at `url` and become it. The endpoint must return a
     * JSON array; anything else leaves the list empty. `data` is the query string
     * for a GET (the default) and the body otherwise — a "post" controller sends
     * it as JSON, which is where a CSRF-guarded endpoint fits. Built on
     * {@link Request}, so the configured base URL, credentials and headers (the
     * CSRF token among them) ride along.
     *
     * Concurrent syncs are safe: a slow response that a newer sync has already
     * outrun is dropped rather than overwriting the fresher list.
     *
     * @param {object} [data] query (GET) or body (POST/PUT/…) for the request.
     * @returns {Promise<Array>} the list as it now stands.
     */
    async sync(data) {
        if (!this._url) {
            throw new Error("ArrayController.sync(): no url to sync from");
        }
        const seq = ++this._syncSeq;
        const result = await Request[this._method](this._url, data);
        // A newer sync started while this was in flight — leave the list to it.
        if (seq !== this._syncSeq) return this._objects;
        this.setContent(Array.isArray(result) ? result : []);
        return this._objects;
    }

    /** @public Append one item to the end. */
    add(object) {
        this._change([...this._objects, object]);
    }

    /** @public Append several items, in the order given. */
    addObjects(objects) {
        this._change([...this._objects, ...objects]);
    }

    /**
     * @public Put `object` at `index`, moving what is there and after it along.
     * An index past the end appends; a negative one counts from the end.
     */
    insert(object, index) {
        const next = [...this._objects];
        next.splice(index, 0, object);
        this._change(next);
    }

    /**
     * @public Remove the first item equal (`===`) to `object`.
     * @returns {boolean} Whether it was there to remove.
     */
    remove(object) {
        const index = this._objects.indexOf(object);
        if (index < 0) return false;
        this.removeAt(index);
        return true;
    }

    /**
     * @public Remove the item at `index`.
     * @returns {*} The item removed, or `undefined` when the index was out of range.
     */
    removeAt(index) {
        if (index < 0 || index >= this._objects.length) return undefined;
        const next = [...this._objects];
        const [removed] = next.splice(index, 1);
        this._change(next);
        return removed;
    }

    /** @public Remove everything. */
    removeAll() {
        if (this._objects.length === 0) return;
        this._change([]);
    }

    // --- telling the bindings ------------------------------------------------

    /**
     * Swap the array for `next` and tell whatever is bound. `objects` and `count`
     * are read-only getters, so nothing wraps them to notice an assignment —
     * they are told by hand here; replacing `_objects` (rather than mutating it)
     * is what lets a drawing that read the array see it change. @private
     */
    _change(next) {
        this._objects = next;
        notify(this, "objects");
        notify(this, "count");
    }
}
