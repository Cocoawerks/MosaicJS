// ProgressiveListView: a list that draws only the rows on screen, however many
// it holds.
// Every row is given a height before it is drawn, so the list knows how tall it
// is and where each row sits without measuring any of them. The scroller is
// given that whole height, the rows in view are placed into it at their own
// offsets, and scrolling redraws the handful that changed.
//   <ProgressiveListView outlet="rows" itemHeight="32" emptyText="Nothing here">
//       <PersonItem/>
//   </ProgressiveListView>
import ListView from "./ListView.js";
import "./list.css";

export default class ProgressiveListView extends ListView {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `ProgressiveListView`. See Component.styleName.
   */
  static styleName = "v-ProgressiveList";

  static props = {
    /**
     * How tall a row is. A number when they are all the same; a function of
     * the row's index when they are not — `getItemHeight(int)` in Java.
     */
    itemHeight: { type: Number, default: 32 },
    /** How far beyond the visible edge to draw, so scrolling stays ahead. */
    extension: { type: Number, default: 300 },
    /** And how many rows past that again. */
    batch: { type: Number, default: 10 },
  };

  constructor(props) {
    super(props);

    /** Where each row starts, and — at the end — how tall the list is. */
    this.offsets = [0];

    /** The rows drawn now: everything in view, and a little either side. */
    this.first = 0;
    this.last = 0;

    /**
     * The drawing of each row in that window, by the index of the datum it
     * holds. What lets a window move without being rebuilt — see `rowFor`.
     */
    this.drawnRows = new Map();
  }

  // --- how tall it is ------------------------------------------------------

  /** How tall the row at `index` is. */
  heightOf(index) {
    const stated = this.props.itemHeight;
    return typeof stated === "function"
      ? stated(index, this.items[index])
      : this.itemHeight;
  }

  /**
   * Where every row starts, counted once per change. The last entry is the
   * height of the whole list, which is what the scroller is given.
   */
  measure() {
    const offsets = new Array(this.items.length + 1);
    offsets[0] = 0;
    for (let index = 0; index < this.items.length; index++) {
      offsets[index + 1] = offsets[index] + this.heightOf(index);
    }
    this.offsets = offsets;
    // A row's drawing carries the offset it was placed at, so it is only good
    // for as long as these are.
    this.forgetRows();
  }

  get totalHeight() {
    return this.offsets[this.offsets.length - 1] ?? 0;
  }

  /** The row at a distance down the list, found by halving the range. */
  indexAt(top) {
    if (top <= 0 || this.items.length === 0) return 0;

    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.offsets[middle + 1] <= top) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  // --- what is on screen ---------------------------------------------------

  /** The rows to draw, which is what the list has worked out it needs. */
  get range() {
    return { start: this.first, end: this.last };
  }

  /**
   * Work out what is in view and redraw if it has changed. Called when the
   * list is scrolled, when it changes size, and when what it holds changes.
   */
  visibleRangeChanged() {
    if (this.items.length === 0) return;

    const scroller = this.scroller;
    const top = scroller?.scrollTop ?? 0;
    const height = scroller?.offsetHeight ?? 0;

    const first = Math.max(0, this.indexAt(top - this.extension) - this.batch);
    const last = Math.min(
      this.items.length,
      this.indexAt(top + height + this.extension) + this.batch,
    );

    if (this.first == first && this.last == last) return;

    this.first = first;
    this.last = last;

    this.needsDisplay();
    // Which rows are on screen is `range`, a getter over the two fields above:
    // scrolling changes it and assigns neither, so nothing watching it hears.
    this.changed("range");
  }

  set content(items) {
    super.content = items;
    this.measure();
    // Everything about what is on screen is now stale.
    this.first = 0;
    this.last = 0;
    this.visibleRangeChanged();
  }

  get content() {
    return this.items;
  }

  // --- while it is on the page ---------------------------------------------

  attached() {
    this.measure();
    this.onScroll = () => this.visibleRangeChanged();
    this.scroller?.addEventListener("scroll", this.onScroll, {
      passive: false,
    });

    if (typeof ResizeObserver === "function") {
      this.watcher = new ResizeObserver(() => this.visibleRangeChanged());
      this.watcher.observe(this.node);
    }
    this.visibleRangeChanged();
  }

  detached() {
    this.scroller?.removeEventListener("scroll", this.onScroll);
    this.watcher?.disconnect();
    this.watcher = null;
    super.detached();
  }

  // --- drawing -------------------------------------------------------------

  /** A row sits at its own offset, in a list as tall as all of them. */
  drawItem(item, index) {
    return super.drawItem(item, index, {
      position: "absolute",
      top: `${this.offsets[index] ?? 0}px`,
      height: `${this.heightOf(index)}px`,
      left: "0",
      right: "0",
    });
  }

  /**
   * The row for `index`, drawn once and kept.
   *
   * A window that moves keeps most of what it had: scrolling from rows 100–200
   * to 120–220 changes twenty of two hundred and twenty rows, and the other two
   * hundred are the rows they were, at the offsets they were, holding the data
   * they held. Handing back the same vnode is how the runtime is told so — it
   * compares a drawing against the one before it, and the same drawing needs no
   * comparing. Only the indexes that came into view are drawn here at all.
   *
   * Emptied whenever the rows themselves change, since a cached drawing is only
   * good for as long as the datum and the offset behind it are.
   */
  rowFor(index) {
    const item = this.items[index];
    const held = this.drawnRows.get(index);
    // The datum is checked rather than trusted: a list can be added to and
    // taken from without being measured again, and a drawing of what used to
    // be at an index is worse than no drawing at all.
    if (held && held.item === item) return held.row;

    const row = this.drawItem(item, index);
    this.drawnRows.set(index, { item, row });
    return row;
  }

  /** Forget every drawn row, so the next drawing builds them afresh. */
  forgetRows() {
    this.drawnRows.clear();
  }

  drawContent() {
    if (this.spinning || this.items.length === 0) {
      this.forgetRows();
      return super.drawContent();
    }

    // The rows in the window, each of them the one drawn last time unless it
    // has only just come into view. What has left the window is dropped, so a
    // list scrolled from one end to the other does not keep every row it ever
    // drew.
    const rows = [];
    for (let index = this.first; index < this.last; index++) {
      rows.push(this.rowFor(index));
    }
    for (const index of [...this.drawnRows.keys()]) {
      if (index < this.first || index >= this.last)
        this.drawnRows.delete(index);
    }

    // The rows are placed into a box the height of the whole list, so the
    // scrollbar says what it would if every row were drawn.
    return (
      <div
        styleName="v-ProgressiveList-sizer"
        style={{ height: `${this.totalHeight}px` }}
        role="none"
      >
        <div role="none">{rows}</div>
      </div>
    );
  }

  listClasses() {
    return [...super.listClasses(), "v-ProgressiveList"];
  }
}
