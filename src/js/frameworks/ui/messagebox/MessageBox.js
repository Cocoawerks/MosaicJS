// MessageBox: a small modal that says something and waits for an answer — an
// alert with one button, a confirm with two, or a prompt with a field to type
// into. Built on {@link Dialog}, and shown the way the snackbar is: a plain
// controller that mounts its own view on the body and takes it down again once
// the question is answered.
//
//   MessageBox.alert("Saved", "Your work is safe.").runModal();
//
//   MessageBox.confirm("Delete?", "This cannot be undone.")
//     .runModal((response) => {
//       if (response === MessageBoxResponse.CONFIRM) remove();
//     });
//
//   const box = MessageBox.prompt("Rename", "What should it be called?");
//   box.runModal((response) => {
//     if (response === MessageBoxResponse.CONFIRM) rename(box.promptText);
//   });
//
// The factories set the title, the message, and the buttons; `runModal` puts it
// up and hands the answer to the callback. `MessageBox` in Java, where it wrapped
// a `Dialog` the same way.
import {Component, MESSAGES, mount} from "mosaic";

import Dialog from "../dialog/Dialog.js";
import Button, {Intent} from "../controls/button/Button.js";
import TextField from "../controls/text/TextField.js";
import "./messagebox.css";

/** How the box was answered, handed to the `runModal` callback. */
export const MessageBoxResponse = Object.freeze({
    CONFIRM: "confirm",
    CANCEL: "cancel",
    OTHER: "other",
});

/**
 * A {@link Dialog} that wears the message-box classes, so a sheet can style
 * the three kinds apart. A class of its own rather than a prop, for the reason
 * the dialog's own close button has one: the sheets are written against
 * `.message-box`, and the class has to be on the dialog element itself.
 */
/**
 * A {@link Button} that fires a plain `onPress` handler. `action` is reserved
 * for the method name markup binds; a button drawn by hand here is handed a
 * function instead, the way the dialog's own close button is.
 */
class PressButton extends Button {
    fireAction(...args) {
        this.props.onPress?.(this.self, ...args);
    }
}

class MessageDialog extends Dialog {
    static properties = {
        ...Dialog.properties,
        /** Which kind it is — `alert`, `confirm`, or `prompt` — as a second class. */
        variant: {type: String, default: "alert"},
    };

    dialogClasses() {
        return [...super.dialogClasses(), "message-box", this.variant];
    }
}

/**
 * The view the controller mounts: a {@link MessageDialog} drawn from the box's
 * current state. Kept apart from the controller so a change to the message or a
 * button redraws through `needsDisplay`, the way every other component here is
 * drawn rather than assembled by hand.
 */
class MessageBoxView extends Component {
    static properties = {
        /** The controller whose state this draws. */
        box: {type: Object},
    };

    draw() {
        const box = this.props.box;

        return (
            <MessageDialog
                variant={box.variant}
                title={box.title}
                width={box.width}
                ref={(dialog) => box.dialogReady(dialog)}
                onOpen={() => box.opened()}
                onClose={() => box.runCallback(MessageBoxResponse.CANCEL)}
            >
                {box.promptField ? (
                    <div styleName="v-MessageBox-body">
                        <div
                            styleName="v-MessageBox-message"
                            ref={(el) => el && (el.innerHTML = box.message)}
                        />
                        <TextField ref={(field) => (box.promptView = field)}/>
                    </div>
                ) : (
                    <div
                        styleName="v-MessageBox-message"
                        ref={(el) => el && (el.innerHTML = box.message)}
                    />
                )}

                {box.hasCancel ? (
                    <PressButton
                        slot="footer"
                        text={box.cancelText}
                        onPress={() => box.runCallback(MessageBoxResponse.CANCEL)}
                    />
                ) : null}
                <PressButton
                    slot="footer"
                    text={box.confirmText}
                    intent={Intent.PRIMARY}
                    onPress={() => box.confirm()}
                />
            </MessageDialog>
        );
    }
}

export default class MessageBox {
    /**
     * @param {string} variant One of `alert`, `confirm`, `prompt` — the class the
     *   dialog wears and, but for the buttons the factories add, all that tells
     *   the three apart.
     */
    constructor(variant = "alert") {
        /** Which kind it is. */
        this.variant = variant;

        /** What the header reads. */
        this.title = "";

        /** The body, taken as HTML the way the Java version's `setHTML` did. */
        this.message = "";

        /** The confirm (primary) button's label. */
        this.confirmText = MESSAGES.get("OK");

        /** The cancel button's label, when there is one. */
        this.cancelText = MESSAGES.get("Cancel");

        /** Whether a cancel button is drawn beside confirm. */
        this.hasCancel = false;

        /** Whether the body carries a field to type into. */
        this.promptField = false;

        /** How wide the dialog is, in pixels, or "" for the standard width. */
        this.width = "";

        /** Set once the answer has been delivered, so it is delivered only once. */
        this.callbackRun = false;

        /** What to tell when it is answered. */
        this.callback = null;

        /** The mounted dialog and its view, once shown. */
        this.dialog = null;
        this.promptView = null;
        this.view = null;
    }

    // --- the three kinds -----------------------------------------------------

    /** A box that says something and has a single button to dismiss it. */
    static alert(title, message) {
        const box = new MessageBox("alert");
        box.title = title;
        box.message = message;
        return box;
    }

    /** A box that asks a yes/no question. */
    static confirm(title, message) {
        const box = new MessageBox("confirm");
        box.title = title;
        box.message = message;
        box.confirmText = MESSAGES.get("Yes");
        box.cancelText = MESSAGES.get("No");
        box.hasCancel = true;
        return box;
    }

    /** A box with a field to type an answer into. */
    static prompt(title, message) {
        const box = new MessageBox("prompt");
        box.title = title;
        box.message = message;
        box.promptField = true;
        box.hasCancel = true;
        return box;
    }

    // --- settings ------------------------------------------------------------

    setTitle(title) {
        this.title = title;
        this.needsDisplay();
        return this;
    }

    setMessage(message) {
        this.message = message;
        this.needsDisplay();
        return this;
    }

    setConfirmButtonText(text) {
        this.confirmText = text;
        this.needsDisplay();
        return this;
    }

    setCancelButtonText(text) {
        this.cancelText = text;
        this.needsDisplay();
        return this;
    }

    /** Add a cancel button to a box that started without one. */
    addCancelButton() {
        this.hasCancel = true;
        this.needsDisplay();
        return this;
    }

    setWidth(width) {
        this.width = width == null ? "" : `${width}px`;
        this.needsDisplay();
        return this;
    }

    /** What was typed into a prompt, or null when there is no field. */
    get promptText() {
        return this.promptView ? this.promptView.value : null;
    }

    set promptText(value) {
        if (this.promptView) this.promptView.value = value;
    }

    // --- showing -------------------------------------------------------------

    /**
     * Put it up and hand the answer to `callback`. The callback is optional — an
     * alert is often shown for its own sake — and is given one of
     * {@link MessageBoxResponse}.
     *
     * @param {(response: string) => void} [callback]
     */
    runModal(callback) {
        this.callback = typeof callback === "function" ? callback : null;
        this.callbackRun = false;

        this.host = document.createElement("div");
        document.body.appendChild(this.host);
        this.unmount = mount(MessageBoxView, this.host, {box: this});
        this.view = this.unmount.view;

        this.dialog?.show();
    }

    /** The dialog has been drawn: hold on to it so `runModal` can show it. */
    dialogReady(dialog) {
        this.dialog = dialog;
    }

    /**
     * The dialog opened. A prompt is there to be typed into, so its field takes
     * focus over the close button the dialog would otherwise keep — done on open
     * rather than earlier because the field is not on the page until then.
     */
    opened() {
        if (this.promptField && this.promptView) {
            this.promptView.setFocus(true);
            this.promptView.selectAll?.();
        }
    }

    /** Redraw the view, if it is up. */
    needsDisplay() {
        this.view?.needsDisplay();
    }

    // --- answering -----------------------------------------------------------

    /**
     * The confirm button, or Enter in the prompt. A disabled confirm button does
     * nothing — Enter pressed while a field is still invalid is ignored until it
     * is enabled.
     */
    confirm() {
        this.runCallback(MessageBoxResponse.CONFIRM);
    }

    /**
     * Deliver the answer, once. Closing the dialog fires its close handler, which
     * would otherwise deliver a second (CANCEL) answer — the guard is what keeps
     * the first the only one.
     *
     * @param {string} response One of {@link MessageBoxResponse}.
     */
    runCallback(response) {
        if (this.callbackRun) return;
        this.callbackRun = true;

        this.dialog?.forceClose();
        this.callback?.(response);

        // Taken off the page after the close has had its frame, so the fade the
        // dialog does on the way out is not cut short by the host vanishing.
        setTimeout(() => this.dispose(), 400);
    }

    /** Take the view off the page altogether. */
    dispose() {
        this.unmount?.();
        this.host?.remove();
        this.unmount = null;
        this.host = null;
        this.view = null;
        this.dialog = null;
    }
}
