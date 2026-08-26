// LoadingButton, ported from GWT Mosaic (client/components/LoadingButton.java):
// a Button that shows a spinner in its icon slot while something it started is
// still running, and refuses to be pressed again meanwhile.
// The spinner waits before appearing. Work that finishes quickly never shows
// one, which is the point: a spinner that flashes for 80ms reads as a glitch.
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
    /** Whether work is running. The spinner may not be showing yet. */
    this.isLoading = false;
    this.timer = null;
    /** Whether the wait has passed and the spinner is on screen. */
    this.showsSpinner = false;
  }

  get loading() {
    return this.isLoading;
  }

  set loading(value) {
    this.setLoading(this.bool(value));
  }

  /**
   * Pressing the button is what starts the work, so pressing it is what puts
   * it into loading: the action fires with the button already disabled, and it
   * stays that way until whoever is doing the work says `loading = false`.
   *
   * The action still fires — it is the thing that goes and does the work — and
   * it fires after the state changes, so an action that finishes immediately
   * can clear the loading it was handed and leave the button as it found it.
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

  /** A button that is taken apart mid-flight must not leave a timer behind. */
  destroy() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    super.destroy();
  }

  // --- drawing -------------------------------------------------------------
  //
  // The spinner occupies the icon slot, which is what the Java version does
  // by inserting a `.icon.button-loader` into the button's layout row and
  // dropping the `noIcon` class.

  /** Always: the slot is the loader's, whether or not it is showing. */
  get hasIcon() {
    return true;
  }

  buttonClasses() {
    return [
      ...super.buttonClasses(),
      "loading",
      this.showsSpinner ? "is-loading" : null,
    ];
  }

  drawIcon() {
    return (
      <div
        styleName={["icon", "button-loader"]}
        style={{ visibility: this.showsSpinner ? "visible" : "hidden" }}
      />
    );
  }

  draw() {
    const drawn = super.draw();
    // The one thing the class list cannot say: whether work is running.
    return {
      ...drawn,
      props: { ...drawn.props, "aria-busy": String(this.isLoading) },
    };
  }
}
