/**
 * The dialog's own controller.
 *
 * What it has to say to the views composed inside it goes through their
 * outlets. `this.reading` is Reading.mib's controller — an outlet on a view
 * that has one hands that over rather than the element it drew — so the dialog
 * can change what it was given after the fact.
 */
export default class SummaryDialogController {
  show() {
    this.dialog.show();
  }

  close() {
    this.dialog.close();
  }

  /**
   * Say something to a composed view. `celsius` is the attribute the markup
   * gave it; assigning it again is the same thing happening a second time, and
   * the view redraws because a prop is ordinary state.
   */
  warmer() {
    this.reading.celsius = this.reading.celsius + 1;
    this.onWarmer?.(this.reading.celsius);
  }
}
