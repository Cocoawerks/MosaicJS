import {setTheme, theme} from "mosaic/frameworks/ui";

/**
 * The controller behind `main.mib`: what the page binds to, and what drives
 * its controls.
 *
 * Two things connect it to the page, and they divide the work cleanly.
 * `{bindings}` are the text the page shows — assigning to one of those
 * properties updates the DOM, because binding to a property is what makes it
 * observed. Outlets are the controls themselves: `outlet="rememberBox"` hands
 * this object the CheckBox, so `this.rememberBox.enabled = false` reaches the
 * control directly.
 *
 * Everything on the page is driven from here. There is no component of its own
 * and no state anywhere else.
 */
export default class AppController {
    /**
     * @param {object} [options] initial values for the page.
     * @param {string} [options.title] the heading the page shows.
     */
    constructor({title = "Mosaic UI — kitchen sink"} = {}) {
        /** @type {string} The heading. */
        this.title = title;

        // Bound in the markup, so assigning to one of these updates its text.

        /** @type {string} Whether the controls are on, as the page words it. */
        this.state = "enabled";
        /** @type {string} The "Remember me" checkbox's value, as text. */
        this.remember = "false";
        /** @type {string} The newsletter checkbox's value, as text. */
        this.newsletter = "false";
        /** @type {string} The chosen colour. */
        this.colour = "red";
        /** @type {string} The Wi-Fi switch's value, as text. */
        this.wifi = "true";
        /** @type {string} The aeroplane-mode switch's value, as text. */
        this.aeroplane = "false";
        /** @type {string} Where the volume slider's knob is. */
        this.volume = "40";
        /** @type {string} The span the range slider holds. */
        this.price = "20–80";
        /** @type {string} What the spin button reads. */
        this.quantity = "3";
        /** @type {string} The chosen size. */
        this.size = "medium";

        /** Which row of the OutlineView is selected. */
        this.place = "inbox";
        /** @type {string} What the name field holds. */
        this.name = "";
        /** @type {string} What the search field holds. */
        this.search = "";
        /** @type {string} What the masked field shows, mask and all. */
        this.phone = "";
        /** @type {string} The same field's digits, without the mask around them. */
        this.phoneDigits = "";
        /** @type {string} What a control last did. */
        this.lastAction = "nothing yet";
        /** @type {string} The theme the page is wearing. */
        this.theme = theme;

        /**
         * Whether the controls below the toolbar are enabled. The toolbar's own
         * button never is disabled — it is what turns them back on.
         *
         * @type {boolean}
         */
        this.enabled = true;
    }

    /**
     * The controls the toolbar switches: every outlet but the toolbar's own.
     *
     * @returns {object[]} The components the markup handed over.
     */
    get controls() {
        return [
            this.defaultButton,
            this.primaryButton,
            this.dangerButton,
            this.successButton,
            this.warningButton,
            this.infoButton,
            this.inverseButton,
            this.toggleStateButton,
            this.tooltipButton,
            this.rememberBox,
            this.newsletterBox,
            this.wifiSwitch,
            this.aeroplaneSwitch,
            this.sizeGroup,
            this.colourCombo,
            this.nameField,
            this.searchField,
            this.phoneField,
            this.saveButton,
            this.volumeSlider,
            this.priceSlider,
            this.quantitySpin,
        ];
    }

    // --- the toolbar ---------------------------------------------------------

    /** Enable or disable every control on the page at once. */
    toggleControls() {
        this.enabled = !this.enabled;
        for (const control of this.controls) control.enabled = this.enabled;

        // The button says what it will do next, so it reads as a switch.
        this.toggleButton.text = this.enabled
            ? "Disable controls"
            : "Enable controls";
        this.toggleButton.intent = this.enabled ? "danger" : "success";

        this.state = this.enabled ? "enabled" : "disabled";
        this.note(
            this.enabled ? "enabled every control" : "disabled every control",
        );
    }

    /**
     * Wear another theme. It is a stylesheet swap and nothing else — no
     * component is redrawn, and every control keeps the state it was in.
     *
     * @param {object} combo The ComboBox that fired.
     * @param {string} value The theme chosen.
     */
    themeChanged(combo, value) {
        this.theme = setTheme(value);
        this.note(`theme: ${value}`);
    }

    // --- what the controls report back ---------------------------------------
    //
    // A control calls its action with itself, so one method can serve a whole
    // row and ask the control that fired which it was. A control that carries a
    // value passes the new one along too.

    /**
     * @param {object} button The Button that was clicked.
     */
    buttonClicked(button) {
        this.note(`clicked the ${button.text} button`);
    }

    /**
     * @param {object} button The toggle Button, latched on or off.
     */
    toggleClicked(button) {
        this.note(`the toggle button is ${button.on ? "on" : "off"}`);
    }

    /**
     * @param {object} box The CheckBox that changed.
     * @param {boolean} value Its new value.
     */
    rememberChanged(box, value) {
        this.remember = String(value);
        this.note(`remember me: ${value}`);
    }

    /**
     * @param {object} box The CheckBox that changed.
     * @param {boolean} value Its new value.
     */
    newsletterChanged(box, value) {
        this.newsletter = String(value);
        this.note(`newsletter: ${value}`);
    }

    /**
     * @param {object} control The Switch that was flipped.
     * @param {boolean} value Its new value.
     */
    wifiChanged(control, value) {
        this.wifi = String(value);
        this.note(`wi-fi: ${value}`);
    }

    /**
     * @param {object} control The Switch that was flipped.
     * @param {boolean} value Its new value.
     */
    aeroplaneChanged(control, value) {
        this.aeroplane = String(value);
        this.note(`aeroplane mode: ${value}`);
    }

    /**
     * @param {object} group The RadioGroup that changed.
     * @param {string} value The option chosen.
     */
    sizeChanged(group, value) {
        this.size = value;
        this.note(`size: ${value}`);
    }

    /**
     * @param {object} combo The ComboBox that changed.
     * @param {string} value The entry chosen.
     */
    colourChanged(combo, value) {
        this.colour = value;
        this.note(`colour: ${value}`);
    }

    // --- the outline ---------------------------------------------------------

    /**
     * @param {object} view The OutlineView.
     * @param {string} value The value of the row that was selected.
     */
    placeChosen(view, value) {
        this.place = value;
        this.note(`place: ${value}`);
    }

    /** Open every row that has one, and shut them again. */
    expandPlaces() {
        this.placesTree.expandAll();
        this.note("expanded every row");
    }

    collapsePlaces() {
        this.placesTree.collapseAll();
        this.note("collapsed every row");
    }

    // --- the text fields -----------------------------------------------------

    /**
     * @param {object} field The TextField that changed.
     * @param {string} value What it now holds.
     */
    nameChanged(field, value) {
        this.name = value;
    }

    /**
     * @param {object} field The TextField the user finished with.
     * @param {string} value What it holds.
     */
    nameSubmitted(field, value) {
        this.note(`name submitted: ${value}`);
    }

    /**
     * @param {object} field The SearchField that changed.
     * @param {string} value What it now holds.
     */
    searchChanged(field, value) {
        this.search = value;
    }

    /**
     * @param {object} field The SearchField the user finished with.
     * @param {string} value What it holds.
     */
    searchSubmitted(field, value) {
        this.note(`searched for: ${value}`);
    }

    /**
     * @param {object} field The MaskedTextField that changed.
     * @param {string} value What it now shows, mask and all.
     */
    phoneChanged(field, value) {
        this.phone = value;
        // What the mask is for: the digits, without its punctuation.
        this.phoneDigits = field.valueWithoutMask;
    }

    /**
     * @param {object} field The MaskedTextField the user finished with.
     */
    phoneSubmitted(field) {
        this.note(`phone submitted: ${field.valueWithoutMask}`);
    }

    /**
     * @param {object} field The SearchField that was cleared.
     */
    searchCleared(field) {
        this.search = "";
        this.note("search cleared");
    }

    // --- the sliders and the spin button --------------------------------------

    /**
     * @param {object} slider The Slider that moved.
     * @param {number} value Where its knob now is.
     */
    volumeChanged(slider, value) {
        this.volume = String(value);
        // The bar follows the slider, which is the point of showing them together.
        this.progress.value = value;
        this.note(`volume: ${value}`);
    }

    /**
     * @param {object} slider The RangeSlider that moved.
     * @param {{start: number, end: number}} value The span it now holds.
     */
    priceChanged(slider, value) {
        this.price = `${value.start}–${value.end}`;
        this.note(`price: ${this.price}`);
    }

    /**
     * @param {object} spin The SpinButton that changed.
     * @param {number} value The number it now reads.
     */
    quantityChanged(spin, value) {
        this.quantity = String(value);
        this.note(`quantity: ${value}`);
    }

    // --- work that takes a moment --------------------------------------------

    /**
     * Pretend to save. The button put itself into loading when it was pressed —
     * that is what pressing it means — so all this owes it is the word when the
     * work is done. The indicator says how it went.
     */
    save() {
        this.indicator.reset("Saving…");
        this.note("saving…");

        setTimeout(() => {
            this.saveButton.loading = false;
            this.indicator.setComplete("Saved");
            this.note("saved");
        }, 900);
    }

    /**
     * Say what just happened; the page shows it on its last line.
     *
     * @param {string} what A sentence for the reader.
     */
    note(what) {
        this.lastAction = what;
    }
}
