// LoadingIndicator, ported from GWT Mosaic
// (client/components/LoadingIndicator.java): a spinner with an optional
// message beneath it, in one of three states.
//
// The states are what a wait actually looks like from a page's side: it is
// running, it finished, or it failed. The spinner becomes a tick or a cross
// rather than being replaced, so nothing moves when the answer arrives.
import {Component} from "mosaic";

import "./loading-indicator.css";

/** How large it is drawn, matching Size in the Java version. */
export const Size = Object.freeze({
    SMALL: "small",
    MEDIUM: "medium",
    LARGE: "large",
    EXTRA_LARGE: "extra-large",
});

/** What it is saying, matching State. */
export const State = Object.freeze({
    LOADING: "loading",
    COMPLETE: "complete",
    FAILED: "failed",
});

export default class LoadingIndicator extends Component {
    /** The line beneath the spinner. An empty message is not drawn at all. */
    get message() {
        return this.get("message", "");
    }

    set message(value) {
        this.set("message", value ?? "");
    }

    get size() {
        return this.get("size", Size.MEDIUM);
    }

    set size(value) {
        this.set("size", value || Size.MEDIUM);
    }

    get state() {
        return this.get("state", State.LOADING);
    }

    set state(value) {
        this.set("state", value || State.LOADING);
    }

    // --- saying how it went --------------------------------------------------

    /** It finished. Pass a message to say so in words as well. */
    setComplete(message) {
        if (message !== undefined) this.message = message;
        this.state = State.COMPLETE;
    }

    /** It failed. The message is drawn as an error. */
    setFailed(message) {
        if (message !== undefined) this.message = message;
        this.state = State.FAILED;
    }

    /** Back to waiting. */
    reset(message) {
        if (message !== undefined) this.message = message;
        this.state = State.LOADING;
    }

    // --- drawing -------------------------------------------------------------

    draw() {
        const state = this.state;
        const message = this.message;

        return (
            <div
                styleName={["v-LoadingIndicator", this.size]}
                role="status"
                aria-live="polite"
                aria-busy={String(state === State.LOADING)}
            >
                <div
                    styleName={[
                        "v-LoadingIndicator-spinner",
                        state === State.COMPLETE ? "is-complete" : null,
                        state === State.FAILED ? "is-failed" : null,
                    ]}
                />

                {message === "" ? null : (
                    <div
                        styleName={[
                            "v-LoadingIndicator-message",
                            state === State.FAILED ? "is-error" : null,
                        ]}
                    >
                        {message}
                    </div>
                )}
            </div>
        );
    }
}
