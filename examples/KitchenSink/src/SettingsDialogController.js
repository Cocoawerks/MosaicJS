/**
 * The dialog's own controller: its state, and what the buttons inside it do.
 *
 * Nothing here belongs to the page that shows the dialog — the page asks for it
 * to be shown and hears back what was settled, and that is the whole of what
 * passes between them.
 */
export default class SettingsDialogController {
  constructor() {
    /** Bound in SettingsDialog.mib, so assigning to this updates it. */
    this.hint = "";

    /** What the field held when the dialog was opened, so Cancel can say. */
    this.name = "";

    /** Whether an unsaved change is worth warning about. The checkbox's. */
    this.warn = true;

    /** Whether the field has been edited since it was last saved. */
    this.dirty = false;
  }

  /**
   * Show it. The page calls this through its outlet — the whole of what it has
   * to say to the dialog.
   *
   * The approver is set here rather than in the markup because it is behaviour:
   * a close asked for by the X, by Escape, or in code all pass through it, and
   * one with something unsaved behind it is refused.
   */
  show() {
    this.dirty = false;
    this.hint = "";
    this.dialog.closeApprover = () => this.mayClose();
    this.dialog.show();
  }

  /**
   * Whether the dialog may close. Refusing once is enough — the hint says so,
   * and a second attempt goes through, which is what makes it a warning rather
   * than a trap.
   */
  mayClose() {
    if (!this.warn || !this.dirty) return true;
    this.dirty = false;
    this.hint = "unsaved changes — close again to discard";
    return false;
  }

  /**
   * @param {object} field The TextField that changed.
   * @param {string} value What it now holds.
   */
  nameChanged(field, value) {
    this.name = value;
    this.dirty = true;
    this.hint = "";
  }

  /**
   * @param {object} box The CheckBox that changed.
   * @param {boolean} value Whether it is now ticked.
   */
  warnChanged(box, value) {
    this.warn = !!value;
  }

  /**
   * Save and go. `forceClose` rather than `close`: the approver guards against
   * losing what was typed, and this is the path that keeps it.
   */
  save() {
    this.onSave?.(this.name);
    this.dialog.forceClose();
  }

  /** Give up. This one goes through the approver, so it can be warned about. */
  cancel() {
    this.dialog.close();
  }
}
