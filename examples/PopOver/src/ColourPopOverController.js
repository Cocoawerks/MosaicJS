/** The popover's own controller: its state, and what its buttons do. */
export default class ColourPopOverController {
    constructor() {
        this.heading = "Pick a colour";
        this.chosen = "";
    }

    /** Every colour button fires this; the button says which it was. */
    pick(button) {
        this.chosen = button.text;
    }

    /**
     * Line it up with something on the page and show it — what the page calls
     * through its outlet on this popover. The popover picks the side: it uses
     * the one its markup asked for, or the opposite when that has no room.
     */
    show(what) {
        this.popover.alignWith(what);
    }

    hide() {
        this.popover.hide();
    }
}
