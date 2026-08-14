// ColorWell, ported from GWT Mosaic (client/components/ColorWell.java): a
// Button whose face is the colour it holds. Pressing it opens a
// ColorChooserPanel in a PopOver hung from the well.
//
// The popover is mounted beside the application rather than drawn inside the
// well: a button may not hold a slider or a field, and the chooser has both.
// That is what `RootPanel.get().add(popOver)` does for the Java version.
import {mount} from "mosaic";

import Button from "../button/Button.js";
import PopOver, {PopOverOrientation} from "../../popover/PopOver.js";
import ColorChooserPanel from "./ColorChooserPanel.js";
import Color from "./Color.js";
import "./colorchooser.css";

/** What the chooser takes up before it has been drawn and can be measured. */
const CHOOSER_WIDTH = 280;
const CHOOSER_HEIGHT = 340;

/** The gap the callout sits in, which a side has to have room for as well. */
const GAP = 12;

export default class ColorWell extends Button {
    static props = {
        /** A well shows a colour, and never a label: there is nothing to say. */
        iconOnly: {type: Boolean, default: true},
    };

    constructor() {
        super();

        /** The colour it holds. */
        this.current = Color.white();

        /** Whether the markup's `color` has been read. */
        this.awakened = false;
    }

    // --- the colour ----------------------------------------------------------

    get color() {
        return this.current;
    }

    set color(value) {
        this.setColor(value, false);
    }

    /**
     * Show `color`, and say whether that counts as the user choosing it.
     *
     * @param {Color} color What the well should hold.
     * @param {boolean} fireEvents Whether to fire the well's action.
     */
    setColor(color, fireEvents = true) {
        if (!color || color.equals(this.current)) return;

        this.current = color;
        this.needsDisplay();
        if (fireEvents) this.fireAction(color);
    }

    /**
     * Read what the markup said, once, at the first drawing — a component has
     * no props before then, and what is read here is state it goes on to own,
     * so reading it again on a later drawing would undo whatever has happened
     * to it since.
     */
    awake() {
        if (this.awakened) return;
        this.awakened = true;

        const stated = this.props.color;
        if (stated instanceof Color) this.current = stated;
        else if (stated) this.current = Color.fromHex(stated) ?? this.current;
    }

    // --- the chooser ---------------------------------------------------------

    /**
     * Pressing the well opens the chooser. A well's action means the colour
     * changed — fired from {@link #setColor} when the chooser reports one — so
     * the press itself says nothing to the application, which is what
     * `addActionHandler(e -> openChooser())` arranges for the Java version.
     */
    click(event) {
        if (!this.enabled) {
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        this.openChooser();
    }

    /** The popover and the chooser in it, built the first time one is asked for. */
    openChooser() {
        if (!this.popOver) this.buildChooser();
        else this.chooser.setColor(this.current, false);

        this.popOver.orientation = this.chooseOrientation();
        this.popOver.alignWith(this.node);

        // The canvases can only paint once they have a size, which they get when
        // the popover is shown.
        this.chooser.paint();
    }

    buildChooser() {
        const host = document.createElement("div");
        document.body.appendChild(host);
        this.chooserHost = host;

        const unmount = mount(PopOver, host, {
            orientation: PopOverOrientation.BOTTOM_LEFT,
            children: [
                <ColorChooserPanel
                    color={this.current}
                    ref={(view) => (this.chooser = view)}
                    onColor={(panel, color) => this.setColor(color)}
                    onPicked={() => this.popOver.hide()}
                />,
            ],
        });
        this.unmountChooser = unmount;
        this.popOver = unmount.view;

        // A press on the well is not a press outside the popover: without this
        // the press would put it away and the click would open it again.
        this.popOver.addCloseException(this.node);
    }

    /** The popover goes when the well does. */
    detached() {
        this.unmountChooser?.();
        this.chooserHost?.remove();
        this.popOver = null;
        this.chooser = null;
    }

    /**
     * Which side to try first, by where the well sits in the window: below it
     * if the chooser fits there, then to its left, then its right, and above it
     * only when nothing else will do — the order the Java version tries.
     *
     * A side has to have room for the chooser *and* the callout gap, so the
     * callout stays in the space between the two rather than over the well.
     */
    chooseOrientation() {
        const box = this.node?.getBoundingClientRect();
        if (!box) return PopOverOrientation.BOTTOM_CENTER;

        const size = this.chooser?.node?.getBoundingClientRect();
        const width = size?.width > 0 ? size.width : CHOOSER_WIDTH;
        const height = size?.height > 0 ? size.height : CHOOSER_HEIGHT;

        if (window.innerHeight - box.bottom >= height + GAP) {
            return this.across("BOTTOM", box);
        }
        if (box.left >= width + GAP) {
            return this.down("LEFT", box);
        }
        if (window.innerWidth - box.right >= width + GAP) {
            return this.down("RIGHT", box);
        }
        return this.across("TOP", box);
    }

    /**
     * For a side above or below, the edge that keeps the chooser on screen: its
     * left against a well on the left of the window, its right against one on
     * the right, and centred between the two.
     */
    across(side, box) {
        const middle = box.left + box.width / 2;
        if (middle < window.innerWidth * 0.4) return PopOverOrientation[`${side}_LEFT`];
        if (middle > window.innerWidth * 0.6) return PopOverOrientation[`${side}_RIGHT`];
        return PopOverOrientation[`${side}_CENTER`];
    }

    /** And for a side left or right, the same by height. */
    down(side, box) {
        const middle = box.top + box.height / 2;
        if (middle < window.innerHeight * 0.4) return PopOverOrientation[`${side}_TOP`];
        if (middle > window.innerHeight * 0.6) return PopOverOrientation[`${side}_BOTTOM`];
        return PopOverOrientation[`${side}_MIDDLE`];
    }

    // --- drawing -------------------------------------------------------------

    /** A Button's classes, and the one that says this is a well. */
    buttonClasses() {
        return ["cw-well", ...super.buttonClasses()];
    }

    /** The colour goes in the icon's place, which is where the label would be. */
    drawIcon() {
        return (
            <i
                styleName="cw-swatch"
                style={{backgroundColor: this.current.toString()}}
                aria-hidden="true"
            />
        );
    }

    /**
     * There is always something to draw in the icon's slot: a Button with
     * neither icon nor text draws neither, and the swatch is both.
     */
    get hasIcon() {
        return true;
    }

    draw() {
        this.awake();
        return super.draw();
    }
}
