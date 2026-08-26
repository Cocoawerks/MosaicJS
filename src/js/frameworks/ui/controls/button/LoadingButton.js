// LoadingButton: a Button that shows a spinner in its icon slot while something
// it started is
// still running, and refuses to be pressed again meanwhile.
import Button from "./Button.js";
import "./loading-button.css";

/** How long work may run before a spinner is shown, in milliseconds. */
let loadingDelay = 300;

/** As `LoadingButton.setLoadingDelay()`: the wait, for every loading button. */
export function setLoadingDelay(millis) {
  loadingDelay = millis;
}

export function getLoadingDelay() {
  return loadingDelay;
}

export default class LoadingButton extends Button {
  constructor(props) {
    super(props);
    this.isLoading = false;
    this.timer = null;
    this.showsSpinner = false;
  }

  get loading() {
    return this.isLoading;
  }

  set loading(value) {
    this.setLoading(this.bool(value));
  }

  /**
   @internal
    */
  fireAction(...args) {
    // A press that arrives while work is running is not a second press; the
    // button is disabled, but a key repeat or a stray event can still reach it.
    if (this.isLoading) return;

    this.setLoading(true);
    super.fireAction(...args);
  }

  /**
   * Start or stop the work this button stands for. While it runs the button
   * is disabled; when it stops the button comes back and the spinner goes,
   * whether or not it ever appeared.
   */
  setLoading(loading) {
    if (this.isLoading === loading) return;
    this.isLoading = loading;
    // `loading` is a getter over the field above, so nothing assigned it.
    this.changed("loading");

    if (loading) {
      this.enabled = false;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.isLoading) return;
        this.showsSpinner = true;
        this.needsDisplay();
      }, loadingDelay);
      return;
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.showsSpinner = false;
    this.enabled = true;
  }

  /**  @internal */
  destroy() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    super.destroy();
  }

  // --- drawing -------------------------------------------------------------

  get hasIcon() {
    return true;
  }

  /**  @internal **/
  buttonClasses() {
    return [
      ...super.buttonClasses(),
      "loading",
      this.showsSpinner ? "is-loading" : null,
    ];
  }

  /**  @internal **/
  drawIcon() {
    return (
      <div
        styleName={["icon", "button-loader"]}
        style={{ visibility: this.showsSpinner ? "visible" : "hidden" }}
      />
    );
  }

  /**  @internal **/
  draw() {
    const drawn = super.draw();
    // The one thing the class list cannot say: whether work is running.
    return {
      ...drawn,
      props: { ...drawn.props, "aria-busy": String(this.isLoading) },
    };
  }
}
