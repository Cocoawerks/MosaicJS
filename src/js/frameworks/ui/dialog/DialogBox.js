// DialogBox, ported from GWT Mosaic (client/components/DialogBox.java and the
// resources/dialogbox/style.css it injects): a native `<dialog>` with a header
// carrying its title and a close button, the caller's content below it, and a
// footer for the buttons that settle it.
//
// The Java version builds its three regions as panels and takes `main` and
// `footer` as `@UiChild` slots. There are no slots here, so a child says which
// region it belongs to and the dialog reads it — the arrangement TitleBar and
// MenuItem are read by. A child that names none is content, which is what a
// dialog mostly holds:
//
//   <!-- SettingsDialog.ib.xml -->
//   <DialogBox title="Settings" outlet="dialog">
//       <p>Whatever the dialog is about.</p>
//       <Button slot="footer" text="Cancel" action="cancel"/>
//       <Button slot="footer" text="Save" intent="primary" action="save"/>
//   </DialogBox>
//
// with the behaviour beside it in SettingsDialogController.js, which the
// compiler pairs with it by name. The page names the dialog as a tag and keeps
// an outlet on it:
//
//   <SettingsDialog outlet="settings"/>
//   <Button text="Settings…" action="showSettings"/>
//
//   showSettings() { this.settings.show(); }
//
// One departure from the Java version, and it is the same one PopOver made: a
// Mosaic component already *is* what it draws, so nothing is added to a root
// panel on the way up. The `<dialog>` is drawn where its markup sits and stays
// there — `showModal()` puts it in the top layer regardless of where in the
// document it lives, which is the whole reason the Java version could get away
// with reparenting it and the reason this one need not.
import { Component } from "mosaic";

import Button from "../controls/button/Button.js";
import Close from "svg:close";
import { closeTransientPopOvers } from "../popover/PopOver.js";
import { scheduleHideMask, showMask } from "./DialogMask.js";
import "./dialog.css";

/**
 * Worn while the dialog is open but not yet shown — see {@link DialogBox#show}.
 * `MEASURING` in Java.
 */
const MEASURING = "is-measuring";

/**
 * Anything that wants to know a dialog has opened, so a surface that is not
 * modal — a side panel, a drawer — can put itself away when one takes over.
 * `openListeners` in Java.
 *
 * @type {Set<Function>}
 */
const openListeners = new Set();

/**
 * A size a tag stated, as CSS — or null when it stated none.
 *
 * A bare number is pixels, which is what `width="820"` in markup means and
 * what an attribute can say at all. Anything with a unit on it is written
 * through untouched, so a dialog can be `"60ch"` or `"70vw"` as easily.
 *
 * @param {string|number|null|undefined} value what the tag said
 * @returns {string|null} a CSS length, or null for nothing said
 */
function cssLength(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  return /^-?\d+(\.\d+)?$/.test(text) ? `${text}px` : text;
}

/** Hear about every dialog that opens, whosever it is. */
export function addOpenListener(listener) {
  openListeners.add(listener);
}

export function removeOpenListener(listener) {
  openListeners.delete(listener);
}

export default class DialogBox extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `DialogBox`. See Component.styleName.
   */
  static styleName = "v-Dialog";

  static props = {
    /** What the header reads. */
    title: { type: String, default: "" },
    /**
     * Whether the page behind it is shut out. A dialog that is not modal
     * leaves what is behind it live and raises no mask.
     */
    modal: { type: Boolean, default: true },
    /**
     * Whether it takes the size of what it holds rather than the standard
     * width. `pack(true)` in Java.
     */
    pack: { type: Boolean, default: false },
    /**
     * Whether a modal dialog dims the page behind it. A small picker opened
     * over another dialog sets this false, so the page is not dimmed twice.
     */
    mask: { type: Boolean, default: true },
    /**
     * How wide the dialog is, when the standard 600px is not what this one
     * wants. A bare number is pixels — `width="820"` — and anything else is
     * written through as it stands, so `"60ch"` and `"70vw"` mean what they
     * say.
     *
     * Stated on the element rather than through a class, since the value is
     * this dialog's own. The sheet's `max-width` still holds above it: a
     * dialog wider than the window would put a scrollbar on the page behind
     * it, which reflows everything back there as it opens.
     */
    width: { type: String, default: "" },
    /**
     * And how tall. Left unsaid it is the height of what it holds, up to the
     * viewport. Stated, the header and footer keep their heights and `main`
     * gives way — so a dialog fixed at a height scrolls its content rather
     * than growing.
     */
    height: { type: String, default: "" },
  };

  constructor() {
    super();

    /** Whether it is up. */
    this.open = false;

    /**
     * Whether it is being sized before it is shown. Kept as a field and drawn
     * as a class rather than written to the node, because a class put on by
     * hand is wiped by the next redraw.
     */
    this.measuring = false;

    /**
     * Consulted before every close — the close button, Escape, and a close
     * asked for in code all pass through it. Returning false calls it off.
     * `setCloseApprover` in Java; null means every close is allowed.
     *
     * @type {(() => boolean)|null}
     */
    this.closeApprover = null;

    // Bound once so they can be taken off again by identity.
    this.onNativeClose = () => this.closed();
    this.onCancel = (event) => {
      // Escape is handled on the way in — see `keyDown` — so a "cancel" that
      // still arrives came from somewhere else the UA dismisses a dialog from.
      // It is put to the approver like any other close.
      if (!this.approved()) event.preventDefault();
    };
    this.onKeyDown = (event) => this.keyDown(event);
  }

  // --- showing and hiding ----------------------------------------------------

  /**
   * Put it up.
   *
   * It is opened invisibly and revealed a frame later, which is the Java
   * version's arrangement and for its reason: a `<dialog>` generates no boxes
   * until it is open, so nothing inside one can size itself before that point.
   * Everything that measures on being shown — a canvas, text being fitted,
   * content that arrives with the widget — therefore does so during that frame
   * at the dialog's settled size, rather than after it is on screen. Skipping
   * it is what made a dialog twitch as it appeared.
   */
  show() {
    if (this.open) return;

    // A dialog takes the foreground: put away any menu or picker still open
    // behind it, so nothing lingers over it.
    closeTransientPopOvers();

    this.open = true;
    this.measuring = true;
    this.needsDisplay();

    if (this.modal && this.mask) showMask();

    // Copied, so a listener that unregisters itself does not change the set
    // that is being walked.
    for (const listener of [...openListeners]) listener();

    // Opened a tick later, so the class above has been drawn before the
    // dialog is switched on and the measuring pass happens under it.
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      const node = this.node;
      if (!node || !this.open) return;

      if (this.modal) node.showModal?.();
      else node.show?.();

      nextFrame(() => {
        // Layout has run: dropping the class starts the fade from a dialog
        // that is already the size it is going to be.
        this.measuring = false;
        this.needsDisplay();
        // The close button takes first focus whatever the DOM order, which is
        // what the Java version's `autofocus` and its explicit `setFocus`
        // between them arrange.
        this.closeButton?.node?.focus?.();
        this.reportOpen();
      });
    }, 0);
  }

  /**
   * Take it down, unless the approver says otherwise.
   *
   * @returns {boolean} Whether it is going.
   */
  close() {
    if (!this.approved()) return false;
    this.forceClose();
    return true;
  }

  /** Close it whatever the approver would have said. `forceClose` in Java. */
  forceClose() {
    if (!this.open) return;

    // A dialog asked to close while it is still on its way up has a switch-on
    // waiting to run: dropping it here is what stops the close being undone a
    // moment later by a dialog that opens itself after being told not to.
    if (this.showTimer !== null && this.showTimer !== undefined) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }

    const node = this.node;
    if (typeof node?.close === "function") {
      // The UA fires "close" for a modal and a non-modal dialog alike, and
      // that is what `closed()` hangs off — so everything that follows a
      // close happens once, however the close was asked for.
      node.close();
    } else {
      // No native `<dialog>` behind it (a server render, a test): there is no
      // event to wait for, so the same tidying is done here.
      this.closed();
    }
  }

  /** Whether a close may go ahead. */
  approved() {
    return !this.closeApprover || this.closeApprover() !== false;
  }

  /** It has gone: drop the mask, and say so. */
  closed() {
    if (!this.open) return;

    this.open = false;
    this.measuring = false;
    if (this.showTimer !== null && this.showTimer !== undefined) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    this.needsDisplay();

    if (this.modal && this.mask) scheduleHideMask();
    this.reportClose();
  }

  get visible() {
    return this.open;
  }

  set visible(value) {
    if (this.bool(value)) this.show();
    else this.close();
  }

  /**
   * Say that it opened, and that it closed — two events rather than one action
   * carrying a boolean. In markup they are `action="open:method"` and
   * `action="close:method"` (compiled to `openAction`/`closeAction`); in
   * JavaScript they are `onOpen` and `onClose`. `action` is left free for what a
   * dialog means by it — a message box's is the button that was pressed.
   */
  reportOpen() {
    this.props.openAction?.(this.self);
    this.props.onOpen?.(this.self);
  }

  reportClose() {
    this.props.closeAction?.(this.self);
    this.props.onClose?.(this.self);
  }

  // --- the keyboard ----------------------------------------------------------

  attached() {
    const node = this.node;
    if (!node?.addEventListener) return;
    node.addEventListener("close", this.onNativeClose);
    node.addEventListener("cancel", this.onCancel);
    node.addEventListener("keydown", this.onKeyDown);
  }

  detached() {
    const node = this.node;
    if (node?.removeEventListener) {
      node.removeEventListener("close", this.onNativeClose);
      node.removeEventListener("cancel", this.onCancel);
      node.removeEventListener("keydown", this.onKeyDown);
    }
    if (this.showTimer !== null && this.showTimer !== undefined) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    // A dialog taken off the page while up was still counted against the mask.
    if (this.open && this.modal && this.mask) scheduleHideMask();
    this.open = false;
  }

  /**
   * Escape and Enter, which are the two keys a dialog owns.
   *
   * Escape closes it, through the approver like every other close. The Java
   * version let the UA's own "cancel" do the closing and only stopped the key
   * travelling — which meant Escape went behind the approver's back, though
   * `setCloseApprover` says it does not. Closing it here is what makes that
   * true: `preventDefault` calls off the UA's own dismissal, so the dialog
   * shuts once, by the one path every close takes.
   *
   * It goes no further either way: one press dismisses one dialog, so a dialog
   * opened over another absorbs its own — `absorbEscape` in Java.
   *
   * Enter presses the primary button, the way Return submits a form. Left
   * alone where a newline is what Enter means, and where something else has
   * already acted on the key.
   */
  keyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (
      event.key !== "Enter" ||
      event.defaultPrevented ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    if (tag === "textarea" || active?.isContentEditable) return;

    const primary = this.node?.querySelector?.(
      ".v-Button.primary:not(.is-disabled)",
    );
    if (!primary) return;
    event.preventDefault();
    primary.click?.();
  }

  // --- what it holds ---------------------------------------------------------

  /** Everything the markup put in it, flattened. */
  get children() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter((child) => child !== null && child !== undefined);
  }

  /**
   * The children belonging to one region. `"main"` is the default, so anything
   * naming no slot is content — which is what a dialog mostly holds.
   */
  slot(name) {
    return this.children.filter(
      (child) => (child?.props?.slot ?? "main") === name,
    );
  }

  // --- drawing ---------------------------------------------------------------

  /** The classes the dialog wears besides `v-Dialog`. */
  dialogClasses() {
    return [
      "v-Dialog",
      // What the sheet reads for "up", rather than the `[open]` attribute the
      // UA writes: the two disagree while the closing fade is in flight, and a
      // closed dialog matched by `[open]` is still laid out and still takes
      // presses. See the note in dialog.css.
      this.open ? "is-open" : null,
      this.pack ? "v-Dialog--auto" : null,
      // A modal dialog is dimmed by the shared mask, so its own backdrop is
      // kept clear — two dims over one dialog is one too many.
      this.modal && this.mask ? "v-Dialog--no-mask" : null,
      this.measuring ? MEASURING : null,
    ];
  }

  /**
   * What the tag said about its size, or nothing — in which case the sheet
   * decides, as it always did.
   *
   * `pack` is left alone by this: it is a class, and a size stated here is on
   * the element, so a dialog given both is the size it was given in the
   * direction it was given one and packed in the other.
   */
  sizeStyle() {
    const width = cssLength(this.width);
    const height = cssLength(this.height);
    if (width === null && height === null) return null;

    // Both stated, the one that was not asked for as the empty string that
    // takes a declaration off. A style object is merged onto the element
    // rather than replacing what is there, so a key simply left out of it
    // leaves whatever was written last time still standing — and a dialog
    // whose height stopped being stated would keep the height it used to have.
    return { width: width ?? "", height: height ?? "" };
  }

  // The bare `<div>` inside is the wrapper the sheet clips the rounded corners
  // against; the dialog element itself stays overflow:visible so a tooltip
  // opened inside it is not cut off.
  draw() {
    return (
      <dialog styleName={this.dialogClasses()} style={this.sizeStyle()}>
        <div>
          <header>
            {this.slot("header")}
            <h2>{this.title}</h2>
            <CloseButton
              iconOnly="true"
              icon={Close}
              tooltip={this.message("Close")}
              ref={(button) => (this.closeButton = button)}
              onPress={() => this.close()}
            />
          </header>

          <main>{this.slot("main")}</main>

          <footer>{this.slot("footer")}</footer>
        </div>
      </dialog>
    );
  }
}

/**
 * The X in the header.
 *
 * A class of its own rather than a `styleName` on the tag, for the reason the
 * snackbar's has one: `styleName` on a component is a prop, and both repos'
 * sheets are written against `.v-Button.close` — the class has to be on the
 * button element itself, which is what a Button's own class list is for.
 */
class CloseButton extends Button {
  buttonClasses() {
    return [...super.buttonClasses(), "close"];
  }

  /**
   * `action` is what markup names, and takes a method name there; `onPress` is
   * what the dialog hands it in JavaScript.
   */
  fireAction(...args) {
    this.props.onPress?.(this.self, ...args);
  }
}

/**
 * Run something on the next frame, or as soon after as the host manages. A
 * frame is what the Java version's `AnimationScheduler` waits for; a host
 * without one — a test, a render off the page — falls back to a timer, so the
 * reveal still happens rather than never.
 */
function nextFrame(run) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}
