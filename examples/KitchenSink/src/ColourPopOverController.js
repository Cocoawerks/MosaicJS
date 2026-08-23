/**
 * The popover's own controller: its state, and what the buttons inside it do.
 *
 * Nothing here belongs to the page that shows the popover — the page asks for it
 * to be shown and hears back what was chosen, and that is the whole of what
 * passes between them.
 */
export default class ColourPopOverController {
  constructor() {
    /** Bound in ColourPopOver.ib.xml, so assigning to these updates it. */
    this.heading = "Pick a colour";
    this.chosen = "";
  }

  /**
   * Every colour button fires this; the button that fired says which it was,
   * so one method serves the row.
   *
   * @param {object} button The Button that was pressed.
   */
  pick(button) {
    this.chosen = button.text;
    this.onPick?.(button.text);
  }

  /**
   * Which side it should try first — one of PopOverOrientation. The page sets
   * it through its outlet on this controller, which is the only thing it has
   * to say about where the popover goes.
   */
  set orientation(value) {
    this.popover.orientation = value;
  }

  get orientation() {
    return this.popover.orientation;
  }

  /**
   * Line it up with something on the page and show it — sender the page calls
   * through its outlet on this popover. The popover picks the side: it uses
   * the one its markup asked for, or the opposite when that has no room.
   *
   * @param {object} sender What it should hang from.
   */
  show(sender) {
    this.popover.alignWith(sender);
  }

  hide() {
    this.popover.hide();
  }
}
