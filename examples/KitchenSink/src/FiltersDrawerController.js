/**
 * The drawer's own controller: what it holds, and what its controls do.
 *
 * Nothing here belongs to the page that shows it — the page opens it and hears
 * back what was chosen, and that is the whole of what passes between them.
 */
export default class FiltersDrawerController {
  constructor() {
    /** What the controls in it currently say. */
    this.unread = false;
    this.starred = false;
    this.sort = "newest";
    this.colour = "#3584E4";
  }

  /** Open it, and put it away. The page says these through its outlet. */
  show() {
    this.drawer.show();
  }

  close() {
    this.drawer.close();
  }

  toggle() {
    this.drawer.toggle();
  }

  get open() {
    return this.drawer.open;
  }

  /**
   * The drawer came out, or went away. Passed on rather than acted on: where
   * it is showing is the page's business, not this controller's.
   *
   * @param {object} drawer The Drawer itself.
   * @param {boolean} open Whether it is now out.
   */
  openChanged(drawer, open) {
    this.onOpenChange?.(open);
  }

  /**
   * One method for both boxes: the box that fired says which it was, so the
   * row is served by one method.
   *
   * @param {object} box The CheckBox that changed.
   * @param {boolean} value Whether it is now ticked.
   */
  filterChanged(box, value) {
    if (box === this.unreadBox) this.unread = !!value;
    else this.starred = !!value;
    this.report();
  }

  /**
   * @param {object} combo The ComboBox that changed.
   * @param {string} value What was chosen.
   */
  sortChanged(combo, value) {
    this.sort = value;
    this.report();
  }

  /**
   * The well's chooser settled on a colour. It is a popover opened from inside
   * the drawer, which is the case the drawer's own stylesheet is written for.
   *
   * @param {object} well The ColorWell that changed.
   * @param {object} colour What it now holds.
   */
  colourChanged(well, colour) {
    this.colour = colour.toHexString();
    this.report();
  }

  /** Put every control back where it started. */
  clear() {
    this.unreadBox.value = false;
    this.starredBox.value = false;
    this.sortCombo.value = "newest";
    this.unread = false;
    this.starred = false;
    this.sort = "newest";
    this.report();
  }

  /** Say what the filters now are, in one line the page can show. */
  report() {
    const on = [
      this.unread ? "unread" : null,
      this.starred ? "starred" : null,
    ].filter(Boolean);
    const what = on.length ? `${on.join("+")} by ${this.sort}` : this.sort;
    this.onChange?.(`${what} ${this.colour}`);
  }
}
