// Wizard: a modal that walks through a sequence of steps, one at a time, with a
// numbered navigator down the side and a Back/Next/Finish bar along the bottom.
// Built on {@link Dialog} and shown the way the snackbar and the message box
// are — a plain controller that mounts its own view on the body.
//
//   const wizard = new Wizard("Set up your account");
//   wizard.addPage(<NamePage title="Your name"/>);
//   wizard.addPage(<PlanPage title="Choose a plan"/>);
//   wizard.runModal({
//     onFinish: () => save(),
//     onCancel: () => {},
//   });
//
// Each page is a {@link WizardPage}: it draws its own content, says whether it
// is complete enough to move on (`canProceed`), and is told when it is entered,
// left, and reset. The wizard reads a page's `title` for the navigator and greys
// Next out while the page reports itself incomplete.
//
// A wizard can end in one of three ways, chosen by how it is set up:
//   • plainly — Finish closes it and calls `onFinish`;
//   • with a completion page — Finish turns to a last, summary step, and its
//     button closes the wizard (`addCompletionPage`);
//   • with a loading page — Finish shows a spinner while `onFinish` does its
//     work, and the caller says how it went with `setLoadingComplete` /
//     `setLoadingFailed` (`setShowLoadingPage(true)`).
//
// `Wizard` in Java, where it wrapped a `Dialog` and a `DeckPanel` the same way.
import {Component, MESSAGES, mount} from "mosaic";

import Dialog from "../dialog/Dialog.js";
import DeckView from "../deck/DeckView.js";
import Button, {Intent} from "../controls/button/Button.js";
import LoadingIndicator, {Size} from "../controls/loading/LoadingIndicator.js";
import "./wizard.css";

/**
 * A {@link Dialog} that wears the wizard class, so the wizard sheet can lay
 * out its navigator and content beside each other. A class of its own for the
 * reason the message box's dialog has one — the sheet is written against the
 * dialog element itself.
 */
class WizardDialog extends Dialog {
    dialogClasses() {
        return [...super.dialogClasses(), "v-Wizard-dialog"];
    }
}

/**
 * A {@link Button} that fires a plain `onPress` handler. `action` is reserved
 * for the method name markup binds; the wizard's bar buttons are drawn by hand
 * and handed functions, the way the dialog's own close button is.
 */
class PressButton extends Button {
    fireAction(...args) {
        this.props.onPress?.(this.self, ...args);
    }
}

/**
 * The view the controller mounts: the dialog, its navigator, the deck of pages,
 * and the button bar — all drawn from the wizard's current state, so a step
 * change or a button becoming enabled is a redraw rather than a reach into the
 * DOM.
 */
class WizardView extends Component {
    static properties = {
        /** The controller whose state this draws. */
        wizard: {type: Object},
    };

    /** One numbered row per page: its position, its title, and where it stands. */
    navigator(wizard) {
        return (
            <nav styleName="v-WizNav">
                {wizard.pages.map((entry, index) => (
                    <div key={index} styleName={wizard.navItemClasses(index)}>
                        <div styleName="v-WizNavNum">{index + 1}</div>
                        <div styleName="v-WizNavTitle">{entry.title}</div>
                    </div>
                ))}
            </nav>
        );
    }

    /** The pages, plus the loading page when the wizard uses one, as deck cards. */
    cards(wizard) {
        const cards = wizard.pages.map((entry, index) => ({
            ...entry.vnode,
            props: {
                ...entry.vnode.props,
                key: `page-${index}`,
                wizard,
                ref: (view) => wizard.pageReady(entry, view),
            },
        }));

        if (wizard.showLoadingPage) {
            // Wrapped rather than classed directly: LoadingIndicator draws its own
            // root and does not carry a `styleName`, so the page class goes on a box
            // around it — which is also what centres the spinner in the content area.
            cards.push(
                <div key="loading" styleName="v-WizLoadPage">
                    <LoadingIndicator
                        size={Size.LARGE}
                        message={wizard.loadingText}
                        ref={(view) => (wizard.loadingView = view)}
                    />
                </div>,
            );
        }
        return cards;
    }

    draw() {
        const wizard = this.props.wizard;

        return (
            <WizardDialog
                title={wizard.title}
                width={wizard.width}
                height={wizard.height}
                ref={(dialog) => (wizard.dialog = dialog)}
                onClose={() => wizard.dialogClosed()}
            >
                <div styleName="v-Wizard-body">
                    {this.navigator(wizard)}
                    <div styleName="v-WizContent">
                        <DeckView
                            selectedIndex={wizard.deckIndex}
                            ref={(deck) => (wizard.deck = deck)}
                        >
                            {this.cards(wizard)}
                        </DeckView>
                    </div>
                </div>

                <div styleName="v-WizBtnBar" slot="footer">
                    {wizard.cancelVisible ? (
                        <PressButton
                            text={wizard.cancelText}
                            onPress={() => wizard.runCallback(false)}
                        />
                    ) : null}
                    <PressButton
                        text={MESSAGES.get("Previous")}
                        enabled={wizard.previousEnabled}
                        onPress={() => wizard.previous()}
                    />
                    <PressButton
                        text={wizard.nextLabel}
                        intent={Intent.PRIMARY}
                        enabled={wizard.nextEnabled}
                        onPress={() => wizard.handleNext()}
                    />
                </div>
            </WizardDialog>
        );
    }
}

export default class Wizard {
    /**
     * @param {string} [title] What the header reads; also settable later.
     */
    constructor(title = "") {
        /** What the header reads. */
        this.title = title;

        /** The dialog's size, as CSS lengths — "" for what the sheet decides. */
        this.width = "";
        this.height = "";

        /** The steps, in order: `{ vnode, view, title }` each. */
        this.pages = [];

        /** Which step is showing, counting from the first. */
        this.currentIndex = 0;

        /** What to tell when it finishes or is cancelled. */
        this.callback = null;

        /** Set once the outcome has been delivered, so it is delivered only once. */
        this.callbackRun = false;

        // --- the loading page ---------------------------------------------------
        /** Whether Finish shows a spinner while the caller does its work. */
        this.showLoadingPage = false;
        /** Whether the spinner is what is currently showing. */
        this.isOnLoadingPage = false;
        /** Whether the caller has said the work is done, one way or the other. */
        this.loadingComplete = false;
        /** Whether the last step is a completion page rather than a form step. */
        this.hasCompletionPage = false;
        /** The spinner's view, once drawn. */
        this.loadingView = null;

        /** The Next button's label on the last form step. */
        this.actionButtonText = MESSAGES.get("Finish");
        /** Its label once the work is done. */
        this.finishButtonText = MESSAGES.get("Finish");
        /** The cancel button's label. */
        this.cancelText = MESSAGES.get("Cancel");
        /** What the spinner says while it turns. */
        this.loadingText = `${MESSAGES.get("pleaseWait")}…`;
        /** What it says once it is done. */
        this.completeText = `${MESSAGES.get("Complete")}!`;

        /** The mounted dialog, deck, and view, once shown. */
        this.dialog = null;
        this.deck = null;
        this.view = null;
    }

    // --- pages ---------------------------------------------------------------

    /**
     * Add a step. The first added is shown at once.
     *
     * @param {object} vnode A {@link WizardPage} element — `<MyPage title="…"/>`.
     */
    addPage(vnode) {
        const entry = {vnode, view: null, title: vnode?.props?.title ?? ""};
        this.pages.push(entry);
        if (this.pages.length === 1) this.currentIndex = 0;
        this.needsDisplay();
        return this;
    }

    /**
     * Add the summary step that ends the wizard. Finish turns to it rather than
     * closing, and its own button then closes the wizard.
     */
    addCompletionPage(vnode) {
        this.addPage(vnode);
        this.hasCompletionPage = true;
        this.needsDisplay();
        return this;
    }

    /**
     * Remove a step, for a flow whose shape depends on an earlier answer: a choice
     * on page one can add a later step, and changing that answer on the way back
     * has to be able to take it out again. If the current page is at or past the
     * one removed, the wizard falls back to the nearest earlier page — a step is
     * not removed out from under the user.
     *
     * @param {object} page The page's view, or the vnode it was added with.
     * @returns {boolean} Whether the page was present.
     */
    removePage(page) {
        const index = this.pages.findIndex(
            (entry) => entry.view === page || entry.vnode === page,
        );
        if (index < 0) return false;

        this.pages.splice(index, 1);
        if (this.pages.length === 0) {
            this.currentIndex = 0;
        } else if (this.currentIndex >= index) {
            this.currentIndex = Math.min(Math.max(index - 1, 0), this.pages.length - 1);
        }
        this.needsDisplay();
        return true;
    }

    // --- showing -------------------------------------------------------------

    /**
     * Put it up and walk from the first step. The callback carries the two ways it
     * can end.
     *
     * @param {{ onFinish?: () => void, onCancel?: () => void }} [callback]
     */
    runModal(callback = {}) {
        this.callback = callback ?? {};
        this.callbackRun = false;
        this.isOnLoadingPage = false;
        this.loadingComplete = false;
        this.currentIndex = 0;

        // Mounted before the first page is entered: the pages are drawn here, and a
        // page's `onEnter` cannot run until its view exists, which it does not until
        // the draw. `showPage(0)` then fires it against the page now on screen.
        this.host = document.createElement("div");
        document.body.appendChild(this.host);
        this.unmount = mount(WizardView, this.host, {wizard: this});
        this.view = this.unmount.view;

        this.showPage(0);
        this.dialog?.show();
    }

    /** A page has been drawn: hold on to its view and take its title from it. */
    pageReady(entry, view) {
        if (!view || entry.view === view) return;
        entry.view = view;
        if (view.title) entry.title = view.title;
    }

    /** A page's `canProceed` may have changed: re-check, so Next follows it. */
    pageChanged() {
        this.needsDisplay();
    }

    // --- moving between steps ------------------------------------------------

    /** Turn to the step at `index`. */
    showPage(index) {
        if (index < 0 || index >= this.pages.length) return;

        const leaving = this.pages[this.currentIndex];
        if (leaving && this.currentIndex !== index) leaving.view?.onLeave();

        this.currentIndex = index;
        this.isOnLoadingPage = false;
        this.pages[index]?.view?.onEnter();

        this.needsDisplay();
        this.focusFirstElement();
    }

    /** Move on, if the current page allows it and there is a step to move to. */
    next() {
        if (this.currentIndex < this.pages.length - 1 && this.canProceed()) {
            this.showPage(this.currentIndex + 1);
        }
    }

    /** Go back — off the loading page to the form, or to the previous step. */
    previous() {
        if (this.isOnLoadingPage) {
            this.resetLoadingPage();
            this.showPage(this.currentIndex);
        } else if (this.currentIndex > 0) {
            this.showPage(this.currentIndex - 1);
        }
    }

    /** The Next/Finish button, whatever it means on the step showing. */
    handleNext() {
        if (this.isOnLoadingPage && this.loadingComplete) this.closeWizard();
        else if (this.isOnCompletionPage()) this.closeWizard();
        else if (this.isLastPage()) this.handleFinish();
        else this.next();
    }

    /** Finish the last form step: load, show the completion page, or just close. */
    handleFinish() {
        if (!this.canProceed()) return;

        if (this.showLoadingPage) {
            this.showLoadingPageInternal();
            this.callback?.onFinish?.();
        } else if (this.hasCompletionPage) {
            this.showCompletionPage();
            this.callback?.onFinish?.();
        } else {
            this.runCallback(true);
        }
    }

    /** Turn to the completion page, when there is one. */
    showCompletionPage() {
        if (this.hasCompletionPage) this.showPage(this.pages.length - 1);
    }

    // --- the loading page ----------------------------------------------------

    /** Show the spinner and lock the bar down while the caller does its work. */
    showLoadingPageInternal() {
        this.isOnLoadingPage = true;
        this.loadingComplete = false;
        this.needsDisplay();
        this.loadingView?.reset(this.loadingText);
    }

    /** Say the work finished; the button becomes Finish and closes the wizard. */
    setLoadingComplete(message = this.completeText) {
        if (!this.isOnLoadingPage) return;
        this.loadingComplete = true;
        this.loadingView?.setComplete(message);
        this.needsDisplay();
    }

    /** Say the work failed; the spinner shows the error and Back becomes live. */
    setLoadingFailed(errorMessage) {
        if (!this.isOnLoadingPage) return;
        this.loadingComplete = true;
        this.loadingView?.setFailed(errorMessage);
        this.needsDisplay();
    }

    /** Take the wizard off the loading page, back to the form. */
    resetLoadingPage() {
        this.isOnLoadingPage = false;
        this.loadingComplete = false;
        this.needsDisplay();
    }

    // --- ending --------------------------------------------------------------

    /** Close without a further callback — the work's own callback already ran. */
    closeWizard() {
        if (this.callbackRun) return;
        this.callbackRun = true;
        this.dialog?.forceClose();
    }

    /**
     * Close and deliver the outcome, once.
     *
     * @param {boolean} finished Whether it finished rather than being cancelled.
     */
    runCallback(finished) {
        if (this.callbackRun) return;
        this.callbackRun = true;
        this.dialog?.forceClose();
        if (finished) this.callback?.onFinish?.();
        else this.callback?.onCancel?.();
    }

    /** The dialog was closed by the X or Escape: cancel, unless the work is done. */
    dialogClosed() {
        if (!this.isOnLoadingPage || !this.loadingComplete) this.runCallback(false);
        this.resetAllPages();
        this.resetLoadingPage();
        setTimeout(() => this.dispose(), 400);
    }

    resetAllPages() {
        for (const entry of this.pages) entry.view?.reset();
    }

    /** Take the view off the page altogether. */
    dispose() {
        this.unmount?.();
        this.host?.remove();
        this.unmount = null;
        this.host = null;
        this.view = null;
        this.dialog = null;
        this.deck = null;
    }

    // --- state the view reads ------------------------------------------------

    /** Whether the current form step is the last one before an ending. */
    isLastPage() {
        const last = this.hasCompletionPage
            ? this.pages.length - 2
            : this.pages.length - 1;
        return this.currentIndex === last;
    }

    /** Whether the completion page is what is showing. */
    isOnCompletionPage() {
        return this.hasCompletionPage && this.currentIndex === this.pages.length - 1;
    }

    /** Whether the current page will let the wizard move on. */
    canProceed() {
        if (this.pages.length === 0) return true;
        return this.pages[this.currentIndex]?.view?.canProceed() ?? true;
    }

    /** Which deck card is on top — the current page, or the loading page. */
    get deckIndex() {
        return this.isOnLoadingPage ? this.pages.length : this.currentIndex;
    }

    /** The Next button's label for the step showing. */
    get nextLabel() {
        if (this.isOnLoadingPage) {
            return this.loadingComplete
                ? this.finishButtonText
                : `${MESSAGES.get("pleaseWait")}…`;
        }
        if (this.isOnCompletionPage()) return this.finishButtonText;
        if (this.isLastPage()) return this.actionButtonText;
        return MESSAGES.get("Next");
    }

    /** Whether Next is live. */
    get nextEnabled() {
        if (this.isOnLoadingPage) return this.loadingComplete;
        if (this.isOnCompletionPage()) return true;
        return this.canProceed();
    }

    /** Whether Back is live. */
    get previousEnabled() {
        if (this.isOnCompletionPage()) return false;
        if (this.isOnLoadingPage) return this.loadingComplete;
        return this.currentIndex > 0;
    }

    /** Whether Cancel is offered. */
    get cancelVisible() {
        if (this.isOnCompletionPage()) return false;
        if (this.isOnLoadingPage) return this.loadingComplete;
        return true;
    }

    /** Where a navigator row stands: current, done, or still ahead. */
    navItemClasses(index) {
        return [
            "v-WizNavItem",
            index === this.currentIndex ? "is-current" : null,
            index < this.currentIndex ? "is-completed" : null,
            index > this.currentIndex ? "is-disabled" : null,
        ];
    }

    // --- settings ------------------------------------------------------------

    setTitle(title) {
        this.title = title;
        this.needsDisplay();
        return this;
    }

    getTitle() {
        return this.title;
    }

    /** Size the dialog in pixels, as `setPixelSize` did. */
    setSize(width, height) {
        this.width = width == null ? "" : `${width}px`;
        this.height = height == null ? "" : `${height}px`;
        this.needsDisplay();
        return this;
    }

    setActionButtonText(text) {
        this.actionButtonText = text;
        this.needsDisplay();
        return this;
    }

    setFinishButtonText(text) {
        this.finishButtonText = text;
        this.needsDisplay();
        return this;
    }

    setCancelButtonText(text) {
        this.cancelText = text;
        this.needsDisplay();
        return this;
    }

    setShowLoadingPage(show) {
        this.showLoadingPage = !!show;
        this.needsDisplay();
        return this;
    }

    setLoadingText(text) {
        this.loadingText = text;
        return this;
    }

    setCompleteText(text) {
        this.completeText = text;
        return this;
    }

    get pageCount() {
        return this.pages.length;
    }

    get currentPage() {
        return this.pages[this.currentIndex]?.view ?? null;
    }

    // --- helpers -------------------------------------------------------------

    /** Focus the first thing on the current page a keyboard can land on. */
    focusFirstElement() {
        setTimeout(() => {
            const node = this.pages[this.currentIndex]?.view?.node;
            const focusable = node?.querySelector?.(
                'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]),' +
                ' select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            focusable?.focus?.();
        }, 0);
    }

    /** Redraw the view, if it is up. */
    needsDisplay() {
        this.view?.needsDisplay();
    }
}
