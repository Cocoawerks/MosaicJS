// The wizard's second step: a plan. It has a default, so this step can always
// be moved on from — `canProceed` is left as its permissive default.
import { WizardPage, ComboBox } from "mosaic/frameworks/ui";

import "./wizard-pages.css";

export default class PlanPage extends WizardPage {
  /** The shared model the wizard's pages fill in, handed down as a prop. */
  get model() {
    return this.props.model;
  }

  /** Record the choice. No `changed()` is needed: any plan is a valid one. */
  planChanged(combo, value) {
    this.model.plan = value;
  }

  draw() {
    return (
      <div styleName="wiz-page">
        <h3 styleName="wiz-heading">Choose a plan</h3>
        <ComboBox
          value={this.model?.plan ?? "free"}
          action="planChanged"
          options={[
            { text: "Free", value: "free" },
            { text: "Pro", value: "pro" },
            { text: "Team", value: "team" },
          ]}
        />
        <p styleName="wiz-hint">Any plan will do for the demo.</p>
      </div>
    );
  }
}
