// Drawer, ported from GWT Mosaic (client/components/Drawer.java and the
// resources/drawer/Drawer.ui.xml it binds): a panel docked against the right
// edge of the window that slides in and *pushes* the page aside rather than
// covering it.
//
// That push is the whole of what makes it a drawer rather than a popover: it
// reserves its width by padding the document, and the page reflows into what is
// left as the panel slides. The rest of the page stays live throughout — a
// drawer is not modal — and Escape or the close button dismisses it.
//
// It is a surface, like a dialog or a popover: it is pinned to the window and
// placed by the runtime, not by the markup around it. So it is the root of a
// `.ib.xml` file of its own, and a page names that file:
//
//   <!-- FiltersDrawer.ib.xml -->        <!-- and in the page -->
//   <Drawer title="Filters">          <FiltersDrawer outlet="filters"/>
//       …what it holds…
//   </Drawer>                         showFilters() { this.filters.open(); }
import { Component } from "mosaic";

import Button from "../controls/button/Button.js";
import Close from "svg:close";
import { addOpenListener, removeOpenListener } from "../dialog/DialogBox.js";
import { closeTransientPopOvers } from "../popover/PopOver.js";
import "./drawer.css";

/**
 * How long the page is kept in step with the slide.
 *
 * Longer than the 220ms the sheet slides for, by the slack the Java version
 * allows: the last frame of a transition is not always the frame it ends on,
 * and a panel that stopped relaying out a moment early left whatever it was
 * pushing measured against a width it no longer had.
 */
const SLIDE_MS = 260;

/** How long the push takes, which is what `drawer.css` transitions for. */
const PUSH_MS = 220;

export default class Drawer extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `Drawer`. See Component.styleName.
   */
  static styleName = "v-Drawer";

  static props = {
    /** What the header reads. */
    title: { type: String, default: "" },
    /**
     * Whether the page is pushed aside to make room. A drawer that is told
     * not to slides over the page instead, which is what a narrow window
     * wants — there is nothing left to push.
     */
    push: { type: Boolean, default: true },
  };

  constructor() {
    super();

    /** Whether it is out. */
    this.open = false;

    /** What had the keyboard when it opened, to hand back when it closes. */
    this.returnFocusTo = null;

    // Bound once so they can be taken off again by identity.
    this.onDialogOpened = () => this.close();
    this.onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      // A drawer is not modal, so it takes Escape only when the key was
      // pressed inside it — the page behind it keeps its own.
      event.stopPropagation?.();
      this.close();
    };
  }

  // --- coming and going ------------------------------------------------------

  /** Slide it in, and push the page aside to make room. */
  show() {
    if (this.open) return;

    // Taking over the foreground: put away any menu or picker still up, and
    // arrange to go if a dialog opens over the page later.
    closeTransientPopOvers();
    addOpenListener(this.onDialogOpened);

    // What had the keyboard before the panel took it, so it can be given back.
    // A modal dialog gets this from the platform — `showModal()` remembers the
    // element that was focused and returns to it on close — but a drawer is an
    // ordinary element and has to keep the place itself.
    const had = document.activeElement;
    this.returnFocusTo =
      had && had !== document.body && had !== this.node ? had : null;

    this.open = true;
    this.needsDisplay();

    // Pushed a frame later, so the panel is painted parked off screen first
    // and the slide and the push start together. Pushing in the same frame as
    // the class lands is pushing against a panel that has no width yet.
    nextFrame(() => {
      if (!this.open) return;
      this.pushPage(this.node?.offsetWidth ?? 0);
      this.keepInStep();

      // The close button takes the keyboard, which is also what makes Escape
      // work: a drawer is not modal and hears the key only when it was pressed
      // inside it, so a panel nothing is focused in could not be dismissed
      // from the keyboard at all.
      //
      // Here rather than a moment earlier: a shut drawer is `inert`, which
      // takes it and everything in it out of the tab order, and that only
      // stops being true once the drawing above has landed.
      this.closeButton?.node?.focus?.();
      // Said once it has finished sliding, so whatever hears it — moving the
      // keyboard into a field, measuring what it holds — is working against a
      // panel that has stopped moving.
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        if (this.open) this.reportOpen(true);
      }, SLIDE_MS);
    });
  }

  /** Slide it out and give the page its room back. */
  close() {
    if (!this.open) return;

    // Asked before the drawing below, which makes the panel `inert` and takes
    // the keyboard off whatever inside it was holding it.
    const wasFocusedInside = this.node?.contains?.(document.activeElement);

    this.open = false;
    this.needsDisplay();
    // After the drawing above, not before: the panel is `inert` by then and
    // whatever inside it held the keyboard has already given it up, so this
    // is the last word on where focus lands rather than something the redraw
    // undoes a moment later.
    this.returnFocus(wasFocusedInside);

    this.pushPage(0);
    this.keepInStep();
    removeOpenListener(this.onDialogOpened);

    clearTimeout(this.openTimer);
    this.openTimer = null;
    this.reportOpen(false);
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  /**
   * Give the keyboard back to whatever had it before the panel opened.
   *
   * Only when the panel still had it: focus moved out into the page while the
   * drawer was open was moved on purpose, and taking it back from there would
   * be the panel reaching for something that is no longer its business. And
   * only to something still on the page — what was focused may have been drawn
   * away in the meantime.
   */
  returnFocus(wasFocusedInside) {
    const back = this.returnFocusTo;
    this.returnFocusTo = null;
    if (!back || !wasFocusedInside) return;
    if (back.isConnected === false) return;
    back.focus?.();
  }

  get visible() {
    return this.open;
  }

  set visible(value) {
    if (this.bool(value)) this.show();
    else this.close();
  }

  /**
   * Say that it opened, or that it closed. Hooks of their own as well as the
   * action, so a kind of drawer that means something else by its action can
   * still hear these — the arrangement DialogBox and PopOver have.
   */
  reportOpen(open) {
    this.props.action?.(this.self, open);
    (open ? this.props.onOpen : this.props.onClose)?.(this.self);
  }

  // --- pushing the page ------------------------------------------------------

  /**
   * Reserve `width` at the right of the page, so what is there is pushed aside
   * rather than covered.
   *
   * Written to the document rather than drawn: it is the page's padding, not
   * this component's, and the transition on it is what keeps the push in step
   * with the slide.
   */
  pushPage(width) {
    if (!this.push) return;
    const body = document.body;
    if (!body?.style) return;

    body.style.transition = `padding-right ${PUSH_MS}ms ease`;
    body.style.paddingRight = `${width}px`;
  }

  /**
   * Tell whoever asked, on every frame of the slide, that the room they have
   * is changing — the same work a window resize would give them.
   *
   * A resize event cannot stand in for this: the window has not changed size,
   * only what is left of it, and anything listening for one would be told
   * nothing. `onLayoutFrame` in Java.
   */
  keepInStep() {
    const tell = this.props.onLayoutFrame;
    if (typeof tell !== "function") return;

    const started = Date.now();
    const step = () => {
      tell(this.self);
      if (Date.now() - started < SLIDE_MS) this.layoutFrame = nextFrame(step);
    };
    this.layoutFrame = nextFrame(step);
  }

  // --- what it listens to ----------------------------------------------------

  attached() {
    this.node?.addEventListener?.("keydown", this.onKeyDown);
  }

  detached() {
    this.node?.removeEventListener?.("keydown", this.onKeyDown);
    removeOpenListener(this.onDialogOpened);
    clearTimeout(this.openTimer);
    this.openTimer = null;
    this.returnFocusTo = null;
    // A drawer taken off the page while it was out had the page pushed for it.
    if (this.open) this.pushPage(0);
    this.open = false;
  }

  // --- drawing ---------------------------------------------------------------

  drawerClasses() {
    return ["v-Drawer", this.open ? "is-open" : null];
  }

  draw() {
    return (
      <div
        styleName={this.drawerClasses()}
        role="complementary"
        aria-hidden={this.open ? null : "true"}
        inert={this.open ? null : ""}
        tabindex="-1"
      >
        <div styleName="header">
          <span styleName="title">{this.title}</span>
          <CloseButton
            iconOnly="true"
            icon={Close}
            tooltip={this.message("Close")}
            ref={(button) => (this.closeButton = button)}
            onPress={() => this.close()}
          />
        </div>

        <div styleName="body">{this.props.children}</div>
      </div>
    );
  }
}

/**
 * The X in the header.
 *
 * A class of its own rather than a `styleName` on the tag: `styleName` on a
 * component is a prop, and every sheet here and in the Java original is written
 * against `.v-Button.close` — the class has to be on the button element itself.
 */
class CloseButton extends Button {
  buttonClasses() {
    return [...super.buttonClasses(), "close"];
  }

  fireAction(...args) {
    this.props.onPress?.(this.self, ...args);
  }
}

/** The next frame, or as near as the host manages. */
function nextFrame(run) {
  if (typeof requestAnimationFrame === "function")
    return requestAnimationFrame(run);
  return setTimeout(run, 16);
}
