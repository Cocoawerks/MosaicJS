// The wizard's first step: a name, which is required.
//
// A WizardPage draws its own content and answers `canProceed()`. This one
// reports itself incomplete until the field holds something, which is what
// greys the wizard's Next button out; `changed()` tells the wizard to re-check
// after every keystroke.
import { WizardPage, TextField } from "mosaic/frameworks/ui";

import "./wizard-pages.css";

export default class NamePage extends WizardPage {
  /** The shared model the wizard's pages fill in, handed down as a prop. */
  get model() {
    return this.props.model;
  }

  /** The wizard may move on once a name has been entered. */
  canProceed() {
    return (this.model?.name ?? "").trim() !== "";
  }

  /** Every keystroke: keep the model current and let the wizard re-check Next. */
  nameChanged(field, value) {
    this.model.name = value;
    this.changed();
  }

  draw() {
    return (
      <div styleName="wiz-page">
        <h3 styleName="wiz-heading">What should we call you?</h3>
        <TextField
          value={this.model?.name ?? ""}
          placeholder="Your name"
          changeAction={(field, value) => this.nameChanged(field, value)}
        />
        <p styleName="wiz-hint">Next stays disabled until this is filled in.</p>
      </div>
    );
  }
}
