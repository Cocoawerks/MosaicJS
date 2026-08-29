/**
 * The controller behind `main.ib.xml`.
 *
 * The page is buttons and a status line; the work is here, where each button's
 * method puts up a dialog. A `MessageBox` and a `Wizard` are shown from code
 * rather than drawn as tags — an alert has no place in the page until it is
 * asked for — so this is where they are built and their answers dealt with.
 */
import { setTheme, theme } from "mosaic/frameworks/ui";
import { MessageBox, MessageBoxResponse, Wizard } from "mosaic/frameworks/ui";

import NamePage from "./NamePage.js";
import PlanPage from "./PlanPage.js";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "Dialogs";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;

    /** @type {string} What the last dialog came back with, for the status line. */
    this.status = "press a button";
  }

  // --- message boxes ---------------------------------------------------------

  /**
   * An alert: one button, shown for its own sake. `runModal` takes no callback
   * here — nothing has to be decided, only acknowledged.
   */
  showAlert() {
    MessageBox.alert(
      "Saved",
      "Your work is safe. This is an <strong>alert</strong> — one button, nothing to decide.",
    ).runModal();
    this.status = "alert shown";
  }

  /**
   * A confirm: a yes/no question. The callback is handed one of
   * {@link MessageBoxResponse}, and the status line says which.
   */
  showConfirm() {
    MessageBox.confirm("Delete file?", "This cannot be undone.").runModal(
      (response) => {
        this.status =
          response === MessageBoxResponse.CONFIRM
            ? "confirm: deleted"
            : "confirm: kept";
      },
    );
  }

  /**
   * A prompt: a line of text. The box is kept in a variable so its
   * `promptText` can be read once the answer comes back CONFIRM.
   */
  showPrompt() {
    const box = MessageBox.prompt("Rename", "What should it be called?");
    box.runModal((response) => {
      if (response === MessageBoxResponse.CONFIRM) {
        const name = box.promptText?.trim();
        this.status = name ? `prompt: renamed to "${name}"` : "prompt: no name given";
      } else {
        this.status = "prompt: cancelled";
      }
    });
  }

  // --- the wizard ------------------------------------------------------------

  /**
   * Build and show the setup wizard. The pages share a plain model object —
   * each writes what it collects into it — so `onFinish` has the answers to
   * hand. The wizard uses a loading page: Finish shows a spinner while the
   * account is "created", and `setLoadingComplete` ends it.
   */
  runWizard() {
    // What the pages fill in. Handed to each page as a prop; the pages read and
    // write it, and this method reads it back when the wizard finishes.
    const model = { name: "", plan: "free" };

    const wizard = new Wizard("Set up your account");
    wizard.setSize(660, 460);
    wizard.setActionButtonText("Create account");
    wizard.setShowLoadingPage(true);

    wizard.addPage(<NamePage title="Your name" model={model} />);
    wizard.addPage(<PlanPage title="Choose a plan" model={model} />);

    wizard.runModal({
      onFinish: () => {
        this.status = `creating account for ${model.name} (${model.plan})…`;
        // Stand in for a request. When the work is done, the loading page is
        // told so, and its Finish button closes the wizard.
        setTimeout(() => {
          wizard.setLoadingComplete(`Welcome, ${model.name}!`);
          this.status = `account created: ${model.name} on the ${model.plan} plan`;
        }, 1400);
      },
      onCancel: () => {
        this.status = "wizard cancelled";
      },
    });
  }

  // --- the theme -------------------------------------------------------------

  /**
   * @param {object} combo The ComboBox that fired.
   * @param {string} value The theme chosen.
   */
  themeChanged(combo, value) {
    this.theme = setTheme(value);
    this.status = `theme: ${value}`;
  }
}
