// The page's controller. The work it needs is not here — it is in Java, under
// `shared/`, compiled to JavaScript by TeaVM and imported like any other module.
// The specifier is the Java package the class is in: `Units` is in `package
// units`, the password rules are in `package auth`.
import { Units } from "units";
import { PasswordValidator } from "auth";

export default class AppController {
  constructor() {
    // Bound by {meters} in the markup. A dash until there is a number to show.
    this.meters = "—";

    // One class per password rule, bound onto its row in the checklist: "ok"
    // once the rule is met, empty until then. The stylesheet turns "ok" into a
    // tick and a green row.
    this.lengthClass = "";
    this.upperClass = "";
    this.digitClass = "";
    this.specialClass = "";
  }

  /** Called on every keystroke in the feet field — `action="change:recalc"`. */
  recalc() {
    const squareFeet = parseFloat(this.feet.value);
    if (Number.isNaN(squareFeet)) {
      this.meters = "—";
      return;
    }
    // The polyglot moment: a Java method, called from JavaScript, with numbers
    // passing straight across.
    const squareMetres = Units.squareFeetToSquareMetres(squareFeet);
    this.meters = `${squareMetres.toFixed(2)} m²`;
  }

  /** Called on every keystroke in the password field — `action="change:validate"`. */
  validate() {
    const password = this.password.value;
    // Each rule is a Java method. The page ticks off whichever now pass.
    this.lengthClass = PasswordValidator.hasMinLength(password) ? "ok" : "";
    this.upperClass = PasswordValidator.hasUpperCase(password) ? "ok" : "";
    this.digitClass = PasswordValidator.hasDigit(password) ? "ok" : "";
    this.specialClass = PasswordValidator.hasSpecial(password) ? "ok" : "";
  }
}
