// AbstractSlider, ported from GWT Mosaic (client/components/AbstractSlider.java):
// what a slider with one knob and a slider with two have in common — the track,
// the filled range behind the knobs, the bounds and step, and the pointer and
// keyboard work that moves a knob about.
//
// A subclass says how many knobs there are and what the slider's value means:
// Slider has one and is worth a number, RangeSlider has two and is worth a span.
import Control from "../Control.js";
import "./slider.css";

/** Which way a slider runs, matching Orientation.java. */
export const Orientation = Object.freeze({
    HORIZONTAL: "horizontal",
    VERTICAL: "vertical",
});

/**
 * Take and give back the pointer, forgivingly.
 *
 * Both throw if the pointer they name is no longer about — a press whose
 * pointer has already gone, or one that was never captured — and neither is
 * worth failing a drag over.
 */
function capturePointer(element, pointerId) {
    try {
        element?.setPointerCapture?.(pointerId);
    } catch {
        // The pointer is gone; the drag carries on without capture.
    }
}

function releasePointer(element, pointerId) {
    try {
        element?.releasePointerCapture?.(pointerId);
    } catch {
        // Nothing was captured, so there is nothing to give back.
    }
}

/**
 * Whether focus arrived from the keyboard, which is what `:focus-visible`
 * answers. A browser that does not know the selector throws on being asked,
 * and there the ring is drawn for any focus rather than for none.
 */
function keyboardFocused(element) {
    try {
        return element.matches(":focus-visible");
    } catch {
        return true;
    }
}

/** The arrow keys that move a knob, and which way they move it. */
const STEPS = {
    horizontal: {ArrowLeft: -1, Left: -1, ArrowRight: 1, Right: 1},
    vertical: {ArrowDown: -1, Down: -1, ArrowUp: 1, Up: 1},
};

export default class AbstractSlider extends Control {
    static props = {
        /** Whether a drag is reported all the way or only where it comes to rest. */
        continuous: {type: Boolean, default: true},
        /** The near end of the track. */
        minValue: {type: Number, default: 0},
        /** The far end. */
        maxValue: {type: Number, default: 100},
        /** How far one move of a knob goes. */
        step: {type: Number, default: 1},
    };

    constructor() {
        super();

        /** Every knob on the track, near end first. */
        this.handles = [];
        /** The knob a press is working, or the only one there is. */
        this.handle = null;
        /**
         * Whether a knob is being dragged. Not named `pointerDown`: that is the
         * method the runtime binds the event to, and a field of the same name
         * would shadow it and leave the slider deaf.
         */
        this.dragging = false;
        this.resizeObserver = null;
        /** Whether the knobs have taken the values the markup gave them. */
        this.awakened = false;

        this.createHandles();
    }

    /**
     * Give the knobs the values the markup stated.
     *
     * Not done in the constructor, which is where the knobs are made: a
     * component is constructed before it is handed its props, so `value` and
     * the bounds are not there to be read yet. The first drawing is the
     * earliest moment they are, and it is the moment before anyone can see the
     * knobs anyway.
     */
    awake() {
        if (this.awakened) return;
        this.awakened = true;
        this.readInitialValues();
    }

    /** What a subclass takes from its props the first time it is drawn. */
    readInitialValues() {
    }

    // --- configuration -------------------------------------------------------

    get orientation() {
        return this.get("orientation", Orientation.HORIZONTAL);
    }

    set orientation(value) {
        this.set("orientation", value || Orientation.HORIZONTAL);
        // The knob was placed with a `left` or a `top`; the other way round it
        // needs the other one, and the one it has would fight the sheet.
        for (const handle of this.handles) {
            if (!handle.element) continue;
            handle.element.style.left = "";
            handle.element.style.top = "";
        }
        this.updateHandles();
    }

    /** Whether the track runs up the page rather than across it. */
    get vertical() {
        return this.orientation === Orientation.VERTICAL;
    }

    set minValue(value) {
        this.set("minValue", Number(value));
        this.updateValue();
    }

    set maxValue(value) {
        this.set("maxValue", Number(value));
        this.updateValue();
    }

    set step(value) {
        this.set("step", Number(value) || 1);
        this.updateValue();
    }

    // --- what a knob may take ------------------------------------------------
    // A range slider narrows these to keep its two knobs in order.

    minValueForHandle() {
        return this.minValue;
    }

    maxValueForHandle() {
        return this.maxValue;
    }

    // --- geometry ------------------------------------------------------------

    /** How long the track is, the way it runs. */
    trackLength() {
        if (!this.node) return 0;
        return this.vertical ? this.node.offsetHeight : this.node.offsetWidth;
    }

    /**
     * Draw the filled part of the track. One knob fills from the near end to
     * the knob; two fill between them, which is what a subclass overrides.
     */
    updateRangeLayer() {
        if (!this.rangeLayer) return;
        const to = this.handles[0].calcPosition() + 10;

        if (this.vertical) {
            this.rangeLayer.style.height = `${this.trackLength() - to}px`;
        } else {
            this.rangeLayer.style.width = `${to}px`;
        }
    }

    // --- what a subclass says -------------------------------------------------

    /** Make the knobs this slider has. Called once, from the constructor. */
    createHandles() {
        throw new Error("a slider must say what knobs it has");
    }

    /** Put every knob where its value says, and redraw the filled range. */
    updateHandles() {
        for (const handle of this.handles) handle.updatePosition();
        this.updateRangeLayer();
    }

    /** Hold the value inside the bounds, after either of them moved. */
    updateValue() {
        this.updateHandles();
    }

    /**
     * A knob moved. The slider redraws, and reports if it was asked to.
     *
     * @param {object} handle The knob that moved.
     * @param {boolean} fireEvents Whether this counts as the user moving it.
     */
    handleMoved(handle, fireEvents) {
        handle.updatePosition();
        this.updateRangeLayer();
        this.updateAria();
        if (fireEvents) this.fireAction(this.value);
    }

    /** Say what the knobs are worth, for a screen reader. */
    updateAria() {
        for (const handle of this.handles) {
            if (!handle.element) continue;
            handle.element.setAttribute("aria-valuenow", String(handle.value));
            handle.element.setAttribute("aria-valuemin", String(this.minValueForHandle(handle)));
            handle.element.setAttribute("aria-valuemax", String(this.maxValueForHandle(handle)));
        }
    }

    // --- behaviour -------------------------------------------------------------
    // The events are the slider's, not the knob's: a press anywhere on the track
    // takes the nearest knob there, which is what makes a track clickable.

    /** The knob a press at this point should work. One knob: always that one. */
    handleFor() {
        return this.handles[0];
    }

    pointerDown(event) {
        if (!this.enabled) return;
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault?.();

        this.handle = this.handleFor(event);
        if (!this.handle) return;

        // A press on the knob itself drags it from where it was taken hold of;
        // a press on the track jumps it there first.
        const onKnob = this.handle.element?.contains?.(event.target);
        if (onKnob) this.handle.grab(event);
        else this.handle.calcValue(event, true);

        // Capture, but no focus: dragging a knob is not a reason to ring it, and
        // the Java version does not focus it either. Tab is what focuses a
        // slider, and the preventDefault above is what keeps the press from
        // doing it instead.
        capturePointer(this.handle.element, event.pointerId);
        this.dragging = true;
        this.setActive(this.handle, true);
    }

    pointerMove(event) {
        if (!this.enabled || !this.dragging || !this.handle) return;
        this.handle.calcValue(event, this.continuous);
    }

    pointerUp(event) {
        if (this.handle) {
            this.setActive(this.handle, false);
            releasePointer(this.handle.element, event.pointerId);
            // Not continuous: the move is reported once, where it came to rest.
            if (this.dragging && !this.continuous) this.fireAction(this.value);
            this.handle.release();
        }
        this.dragging = false;
    }

    /**
     * The knob wears the theme's focus ring while it has focus, as
     * SliderHandle.onFocus/onBlur arrange in Java.
     *
     * `focusin`/`focusout` rather than `focus`/`blur`: the knob is a child of
     * the slider, and only these two bubble up to where the events are bound.
     * The state is the handle's rather than a class set on the element, so a
     * redraw cannot quietly wipe the ring off.
     */
    focusIn(event) {
        if (!this.enabled) return;
        const handle = this.handles.find((h) => h.element === event.target);
        if (!handle || handle.focused) return;

        // Only a keyboard's focus is worth a ring. `:focus-visible` is the
        // browser's own judgement of which kind of focus this was — the same
        // test the combo box's frame is drawn off — so a press that focuses the
        // knob anyway still leaves it unringed.
        if (!keyboardFocused(event.target)) return;

        handle.focused = true;
        this.needsDisplay();
    }

    focusOut(event) {
        const handle = this.handles.find((h) => h.element === event.target);
        if (!handle || !handle.focused) return;
        handle.focused = false;
        this.needsDisplay();
    }

    /** Mark the knob being worked, which the sheet draws differently. */
    setActive(handle, active) {
        handle.element?.classList?.[active ? "add" : "remove"]("is-active");
    }

    keyDown(event) {
        if (!this.enabled) return;
        const step = STEPS[this.orientation]?.[event.key];
        if (!step) return;

        event.preventDefault?.();
        event.stopPropagation?.();

        const handle = this.handleForKey(event) ?? this.handles[0];
        handle.setValue(handle.value + step * this.step, true);
    }

    /** Which knob the keyboard moves: the one with focus, or the only one. */
    handleForKey(event) {
        return this.handles.find((h) => h.element === event.target) ?? null;
    }

    // --- lifecycle ---------------------------------------------------------------

    /**
     * A slider's arithmetic is all in pixels, so it has to be redone whenever the
     * track changes width — a window resize, a panel opening, a font loading.
     */
    attached() {
        super.attached?.();
        this.updateHandles();
        this.updateAria();

        if (typeof ResizeObserver === "function" && this.node) {
            this.resizeObserver = new ResizeObserver(() => this.updateHandles());
            this.resizeObserver.observe(this.node);
        }
    }

    detached() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        super.detached?.();
    }

    // --- drawing -------------------------------------------------------------

    sliderClasses() {
        return ["v-Slider", this.orientation, ...this.controlClasses()];
    }

    /**
     * One knob. The element is drawn here so that `.v-Slider .handle` — a rule
     * of this module's stylesheet — can reach it, and handed to the handle.
     */
    drawHandle(handle, label) {
        return (
            <div
                styleName={["handle", handle.focused ? "is-focused" : null]}
                role="slider"
                tabindex={this.enabled ? "0" : "-1"}
                aria-label={label}
                aria-orientation={this.orientation}
                ref={(el) => {
                    handle.element = el;
                    handle.updatePosition();
                    this.updateAria();
                }}
            />
        );
    }

    draw() {
        this.awake();
        return (
            <div {...this.controlProps()} styleName={this.sliderClasses()} tabindex={null}>
                <div styleName="range" ref={(el) => (this.rangeLayer = el)}/>
                {this.drawHandles()}
            </div>
        );
    }
}
