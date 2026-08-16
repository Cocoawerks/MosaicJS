// ProgressiveListView, ported from GWT Mosaic
// (client/components/ProgressiveListView.java): a list that draws only the rows
// on screen, however many it holds.
//
// Every row is given a height before it is drawn, so the list knows how tall it
// is and where each row sits without measuring any of them. The scroller is
// given that whole height, the rows in view are placed into it at their own
// offsets, and scrolling redraws the handful that changed.
//
//   <ProgressiveListView outlet="rows" itemHeight="32" emptyText="Nothing here">
//       <PersonItem/>
//   </ProgressiveListView>
import ListView from "./ListView.js";
import "./list.css";

export default class ProgressiveListView extends ListView {
  static props = {
    /**
     * How tall a row is. A number when they are all the same; a function of
     * the row's index when they are not — `getItemHeight(int)` in Java.
     */
    itemHeight: { type: Number, default: 32 },
    /** How far beyond the visible edge to draw, so scrolling stays ahead. */
    extension: { type: Number, default: 300 },
    /** And how many rows past that again. */
    batch: { type: Number, default: 5 },
  };

  constructor() {
    super();

    /** Where each row starts, and — at the end — how tall the list is. */
    this.offsets = [0];

    /** The rows drawn now: everything in view, and a little either side. */
    this.first = 0;
    this.last = 0;
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

    if (first === this.first && last === this.last) return;
    this.first = first;
    this.last = last;
    this.needsDisplay();
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
    this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });

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

  drawContent() {
    const drawn = super.drawContent();
    if (this.spinning || this.items.length === 0) return drawn;

    // The rows are placed into a box the height of the whole list, so the
    // scrollbar says what it would if every row were drawn.
    return (
      <div
        styleName="v-ProgressiveList-sizer"
        style={{ height: `${this.totalHeight}px` }}
        role="none"
      >
        {drawn}
      </div>
    );
  }

  listClasses() {
    return [...super.listClasses(), "v-ProgressiveList"];
  }
}
