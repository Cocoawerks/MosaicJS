// Tooltip, ported from GWT Mosaic (client/components/Tooltip.java): a popover
// of a few words that shows itself when the pointer rests on something.
//
// It is not drawn where it is used — it hangs off something already on the
// page, so it is attached to that rather than nested in markup:
//
//   Tooltip.attach(this.saveButton, "Save what has been typed");
//
// which is what `new Tooltip(target, text)` does in Java, where a PopOver adds
// itself to the RootPanel when it is built.
import {mount} from "mosaic";

import PopOver, {PopOverOrientation} from "./PopOver.js";
import "./tooltip.css";

/** How long the pointer must rest before the words appear. */
const SHOW_DELAY = 800;

export default class Tooltip extends PopOver {
    static props = {
        /** The words it shows. */
        text: {type: String, default: ""},
        /** How long the pointer must rest on the target first, in ms. */
        showDelay: {type: Number, default: SHOW_DELAY},
        /**
         * A tooltip stays where it was put: it is not dismissed by a press
         * outside, because the pointer leaving its target is what puts it away.
         */
        transient: {type: Boolean, default: false},
    };

    constructor() {
        super();

        /** What it hangs off, once it has been attached to something. */
        this.target = null;

        /**
         * Whether it shows at all. A control that has taken its tooltip back —
         * a button switched to the native `title` — turns this off rather than
         * unbinding, so it can be turned on again.
         */
        this.active = true;

        this.onEnter = () => this.scheduleShow();
        this.onLeave = () => this.dismiss();
        this.onPress = () => this.dismiss();
    }

    /**
     * Hang a tooltip off `target` and put it on the page. The tooltip goes when
     * the target does.
     *
     * @param {Element|object} target What it belongs to.
     * @param {string} text The words to show.
     * @param {string} [orientation] Which side to try first.
     * @returns {Tooltip} The tooltip, so it can be turned off later.
     */
    static attach(target, text, orientation = PopOverOrientation.BOTTOM_CENTER) {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const unmount = mount(Tooltip, host, {text, orientation, callout: true});
        const tooltip = unmount.view;
        tooltip.host = host;
        tooltip.unmountSelf = unmount;
        tooltip.attachTo(target);
        return tooltip;
    }

    /** Watch `target`, and show against it when the pointer rests there. */
    attachTo(target) {
        this.unwatch();
        this.target = target?.nodeType === 1 ? target : target?.node ?? null;
        if (!this.target) return;

        this.target.addEventListener("pointerenter", this.onEnter);
        this.target.addEventListener("pointerleave", this.onLeave);
        this.target.addEventListener("pointerdown", this.onPress);
    }

    unwatch() {
        if (!this.target) return;
        this.target.removeEventListener("pointerenter", this.onEnter);
        this.target.removeEventListener("pointerleave", this.onLeave);
        this.target.removeEventListener("pointerdown", this.onPress);
        this.target = null;
    }

    /** Take it out of the page altogether. */
    dispose() {
        this.dismiss();
        this.unwatch();
        this.unmountSelf?.();
        this.host?.remove();
    }

    /**
     * Whether it shows at all. Turning it off puts away whatever is up, so a
     * control that has just been disabled is not left explaining itself.
     */
    setActive(active) {
        this.active = this.bool(active);
        if (!this.active) this.dismiss();
    }

    /**
     * Show it, once the pointer has rested long enough. A target that is
     * disabled shows nothing: hovering it should not explain an action that
     * cannot be taken.
     */
    scheduleShow() {
        if (!this.active) return;
        if (this.target?.getAttribute?.("aria-disabled") === "true") return;
        if (this.target?.disabled) return;

        this.cancel();
        this.timer = setTimeout(() => {
            this.timer = null;
            this.alignWith(this.target);
        }, this.showDelay);
    }

    /** Put it away, and forget any showing that was on its way. */
    dismiss() {
        this.cancel();
        this.hide();
    }

    cancel() {
        if (this.timer === null || this.timer === undefined) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    detached() {
        this.cancel();
        this.unwatch();
        super.detached();
    }

    // --- drawing -------------------------------------------------------------

    panelClasses() {
        return ["v-Tooltip"];
    }

    /** A tooltip holds its words and nothing else. */
    drawContent() {
        return this.text;
    }
}
