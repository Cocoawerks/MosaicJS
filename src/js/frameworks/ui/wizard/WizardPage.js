// WizardPage: one step of a Wizard.
//
// A page is an ordinary component with a few extra points the wizard calls at
// the moments that matter — as it is turned to, as it is left, and when the
// wizard is reset for another run — and one question it answers: whether the
// step is complete enough to move on from. A subclass draws its own content and
// overrides whichever of these it has something to say about; the defaults let
// a page through and do nothing.
//
//   export default class NamePage extends WizardPage {
//     static properties = { ...WizardPage.properties };
//     get title() { return "Your name"; }
//     canProceed() { return this.field?.value.trim() !== ""; }
//     draw() {
//       return (
//         <div>
//           <TextField ref={(f) => (this.field = f)} onInput={() => this.changed()} />
//         </div>
//       );
//     }
//   }
//
// `WizardPage` in Java, a `Composite`. There the title came from an abstract
// `getTitle()`; here it is a `title` property so the wizard can read it off the
// page like any other setting — a subclass that computes one still overrides the
// getter.
import {Component} from "mosaic";

export default class WizardPage extends Component {
    /**
     * The class this component draws its root with — what a stylesheet is
     * naming when it says `WizardPage`. See Component.primaryStyleName.
     */
    static primaryStyleName = "v-WizardPage";

    static properties = {
        /** The step's name, shown beside its number in the wizard's navigator. */
        title: {type: String, default: ""},
    };

    /**
     * The step's name, as the navigator draws it. A property so it can be stated
     * in markup — `<NamePage title="Your name"/>` — and read off the page by the
     * wizard; a subclass whose title depends on something overrides the getter.
     * `getTitle()` in Java.
     */
    get title() {
        return this.get("title", "");
    }

    set title(value) {
        this.set("title", value ?? "");
    }

    /**
     * Whether the wizard may move on from this page. Consulted before Next and
     * before Finish, and again by the wizard to decide whether Next is enabled —
     * so a page that reports itself incomplete greys the button out rather than
     * letting a click be refused. The default lets every step through.
     *
     * @returns {boolean}
     */
    canProceed() {
        return true;
    }

    /**
     * Tell the wizard the answer to {@link canProceed} may have changed, so it
     * can re-check and enable or disable Next. A page calls this from an input's
     * handler — there is nothing the wizard can observe on its own that says a
     * field was typed into.
     */
    changed() {
        this.props.wizard?.pageChanged?.(this.self);
    }

    /** Called as the wizard turns to this page. */
    onEnter() {
    }

    /** Called as the wizard leaves this page for another. */
    onLeave() {
    }

    /**
     * Put the page back to how it started, for a wizard shown a second time. The
     * default does nothing; a page with fields clears them here.
     */
    reset() {
    }
}
