/**
 * The popover's own controller: what the page says to the popover, and nothing
 * about what is inside it.
 */
export default class DetailPopOverController {
  /**
   * Line it up with something on the page and show it.
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
