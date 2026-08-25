// SnackBar, ported from GWT Mosaic (client/components/SnackBar.java and the
// resources/snackbar/SnackBar.ui.xml it binds): a small bar that appears over
// the page to say something happened, and takes itself away again.
//
// A bar is shown through a SnackBarManager, which is what puts it on the page
// and stacks it with whatever else is up — a bar never adds itself. What it
// says is its children, so a bar of an application's own can be a `.ib.xml` file
// whose root is this component:
//
//   <!-- SavedBar.ib.xml -->
//   <SnackBar intent="success" icon="svg:check" userClosable="true">
//       <span>Everything was saved</span>
//       <Button text="Undo" action="undo"/>
//   </SnackBar>
//
// and the page shows one with `this.bars.show(<SavedBar/>)`. For a line of text
// and nothing else there is Toast, which is this with the text drawn for it.
import { Component } from "mosaic";

import Button, { Intent } from "../controls/button/Button.js";
import Close from "svg:close";
import "./snackbar.css";

/**
 * Where a bar is in its coming and going — SnackBarAnimationState.java, whose
 * class names these are. A bar is drawn in one of them:
 *
 *   enter   — placed, but still off screen
 *   appear  — on its way to where it belongs, and then sitting there
 *   exit    — fading out, its place still held until it goes
 */
export const SnackBarAnimationState = Object.freeze({
  ENTER: "v-SnackBar-enter",
  APPEAR: "v-SnackBar-appear",
  EXIT: "v-SnackBar-exit",
});

/**
 * How long the fade out is given before the bar is taken off the page.
 *
 * It has to match the `transition-duration` on `.v-SnackBar-exit` in
 * snackbar.css: shorter and the bar is pulled out from under its own fade —
 * which is what the Java version did, taking it away at 400ms through a 500ms
 * fade, so it vanished while still a fifth visible.
 *
 * Shorter than the Java version's half second, too. That length reads as a
 * gentle exit for a bar going by itself, but the same fade after a press on the
 * close button reads as the press not having landed: a dismissal should look
 * answered at once. What it costs is a little of the fade's softness, which is
 * worth less than the button feeling dead.
 */
const EXIT_DURATION = 200;

/** How long a bar stays, in seconds, unless it is told otherwise. */
const DEFAULT_LIFESPAN = 5;

export default class SnackBar extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `SnackBar`. See Component.styleName.
   */
  static styleName = "v-SnackBar";

  static props = {
    /** One of Intent, which decides the face it wears. */
    intent: { type: String, default: Intent.DEFAULT },
    /**
     * How long it stays, in seconds. A bar with a lifespan of -1 stays
     * until something closes it — the user, or the application.
     */
    lifespan: { type: Number, default: DEFAULT_LIFESPAN },
    /** Whether it carries a close button. */
    userClosable: { type: Boolean, default: true },
    /** A font-icon class name, or an icon component, drawn before what it says. */
    icon: { type: String },
  };

  constructor() {
    super();

    /**
     * Where it is in its coming and going. A field the bar draws rather than
     * a class set on the node: a class put on by hand is wiped by the next
     * redraw, and a bar redraws whenever what it says changes.
     */
    this.animation = null;

    /** The manager that put it up, which is where it goes back to. */
    this.manager = null;

    /** Whether it has already begun to go, so it only goes once. */
    this.closing = false;
  }

  // --- how long it stays ---------------------------------------------------

  /**
   * Start the clock, or stop it. Called when the bar lands on the page —
   * `onAttach` in Java — and again by anything that changes its lifespan.
   *
   * @param {number} [seconds] How long it has left; its own lifespan by default.
   */
  setLifespan(seconds = this.lifespan) {
    clearTimeout(this.lifeTimer);
    this.lifeTimer = null;
    if (seconds < 0) return;

    this.lifeTimer = setTimeout(() => {
      this.lifeTimer = null;
      this.close();
    }, seconds * 1000);
  }

  attached() {
    this.setLifespan();
    this.reportOpen();
  }

  detached() {
    clearTimeout(this.lifeTimer);
    clearTimeout(this.exitTimer);
    this.lifeTimer = null;
    this.exitTimer = null;
  }

  // --- coming and going ----------------------------------------------------

  /** Draw the bar in one of the states above. The manager decides which. */
  setAnimation(state) {
    if (this.animation === state) return;
    this.animation = state;
    this.needsDisplay();
  }

  /**
   * Take the bar away. It fades first unless there is to be no animation, in
   * which case it goes at once — what the manager was told, or what a caller
   * asks for here.
   *
   * @param {boolean} [noAnimation] Whether to go without fading.
   */
  close(noAnimation = !(this.manager?.allowsAnimation ?? true)) {
    if (this.closing) return;
    this.closing = true;

    clearTimeout(this.lifeTimer);
    this.lifeTimer = null;

    if (noAnimation) {
      this.finishClosing();
      return;
    }

    this.setAnimation(SnackBarAnimationState.EXIT);
    this.exitTimer = setTimeout(() => {
      this.exitTimer = null;
      this.finishClosing();
    }, EXIT_DURATION);
  }

  /** Off the page, and say so. */
  finishClosing() {
    this.manager?.remove(this.self);
    this.reportClose();
  }

  /**
   * Say the bar has appeared, and that it has gone — an `open` and a `close`
   * event, the way PopOver and DialogBox read: `action="open:method"` /
   * `action="close:method"` in markup (compiled to `openAction`/`closeAction`),
   * `onOpen`/`onClose` in JavaScript. `action` is left for what a bar is for.
   */
  reportOpen() {
    this.props.openAction?.(this.self);
    this.props.onOpen?.(this.self);
  }

  reportClose() {
    this.props.closeAction?.(this.self);
    this.props.onClose?.(this.self);
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The classes the bar wears. `intent` is carried as well as the intent's own
   * name, which is what the sheet's shared intent rules are written against —
   * `buildClassName()` in Java.
   */
  barClasses() {
    return [
      "v-SnackBar",
      this.intent !== Intent.DEFAULT ? "intent" : null,
      this.intent !== Intent.DEFAULT ? this.intent : null,
      this.animation,
    ];
  }

  /** An icon may be a class name or a component, as a Button's may. */
  drawIcon() {
    const icon = this.icon;
    if (!icon) return null;

    if (typeof icon === "function") {
      const Glyph = icon;
      return (
        <div styleName="icon" aria-hidden="true">
          <Glyph />
        </div>
      );
    }
    return <div styleName={["icon", icon]} aria-hidden="true" />;
  }

  /** What the bar says, and the icon before it: `contentLayer` in the template. */
  drawContentLayer() {
    return (
      <div>
        {this.drawIcon()}
        {this.drawContent()}
      </div>
    );
  }

  /** What the bar says. A plain SnackBar says whatever it was given. */
  drawContent() {
    return this.props.children;
  }

  /**
   * A bar that is not user-closable is drawn without the button rather than
   * with a hidden one: nothing is left for the keyboard or a screen reader to
   * find, and the row does not keep its place.
   */
  drawClose() {
    if (!this.userClosable) return null;

    return (
      <CloseButton
        iconOnly="true"
        icon={Close}
        tooltip={this.message("Close")}
        onPress={() => this.close()}
      />
    );
  }

  draw() {
    return (
      <div styleName={this.barClasses()} role="status" aria-live="polite">
        <div styleName="v-SnackBar-content">
          {this.drawContentLayer()}
          {this.drawClose()}
        </div>
      </div>
    );
  }
}

/**
 * The X at the end of the bar.
 *
 * A class of its own rather than a `styleName` on the tag: `styleName` on a
 * component is a prop, and the themes in both repos write their rules against
 * `.v-Button.close` — the class has to be on the button element itself, which
 * is what a Button's own class list is for.
 */
class CloseButton extends Button {
  buttonClasses() {
    return [...super.buttonClasses(), "close"];
  }

  /**
   * `action` is what a page names in markup, and takes a method name there;
   * `onPress` is what the bar hands it in JavaScript — the same arrangement
   * the colour chooser has with its panel.
   */
  fireAction(...args) {
    this.props.onPress?.(this.self, ...args);
  }
}
