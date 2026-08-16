import { setTheme, theme, Tooltip } from "mosaic/frameworks/ui";

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
  constructor({ title = "Mosaic UI — kitchen sink" } = {}) {
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

    /** What the popover last reported back. */
    this.picked = "";

    /** The colour the well holds, as it reads. */
    this.wellColour = "#3584E4";

    /** What the Edit menu last chose. */
    this.edit = "";

    /** What the box's wells last reported. */
    this.boxColour = "#3584E4";

    /** Which accordion sections are open, as they read. */
    this.sections = "delivery";

    /** How many people the plain list holds. */
    this.peopleCount = "0";
    /** How many the big list holds, and how many of those are drawn. */
    this.crowdCount = "0";
    this.crowdDrawn = "0";

    /** Which tab of the TabView is chosen. */
    this.tab = "0: Overview";

    /** What was last worked in the title bar or the toolbar. */
    this.bar = "nothing yet";

    /** The side the popover is asked to try first. */
    this.where = "bottom_center";
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
      this.colourWell,
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

  // --- the menu and the tooltip ---------------------------------------------

  /**
   * The button the tooltip hangs off, handed over by its outlet.
   *
   * A tooltip is not drawn where it is used — it belongs to something already
   * on the page — so it is attached once that thing exists. The outlet is
   * assigned on every redraw, so it is attached only the first time.
   *
   * @param {object} button The Button to explain.
   */
  set hoverButton(button) {
    this.hovered = button;
    if (!button || this.tooltip) return;
    this.tooltip = Tooltip.attach(button, "A tooltip, once the pointer rests");
  }

  get hoverButton() {
    return this.hovered;
  }

  /**
   * The menu button's action is the item its menu chose, not the press.
   *
   * @param {object} button The MenuButton.
   * @param {string} value The value of the item that was chosen.
   */
  editChosen(button, value) {
    this.edit = value;
    this.note(`edit menu: ${value}`);
  }

  // --- the box and the accordion --------------------------------------------

  /**
   * Either well in the box reports here; which one it was is the well itself.
   *
   * @param {object} well The ColorWell that changed.
   * @param {object} colour The colour it now holds.
   */
  boxColourChanged(well, colour) {
    this.boxColour = colour.toHexString();
    this.note(`box colour: ${this.boxColour}`);
  }

  /**
   * A section was opened or shut. The view says which and which way, so the
   * page keeps no list of its own.
   *
   * @param {object} view The AccordionView.
   * @param {string} value The section's value.
   * @param {boolean} expanded Whether it is now open.
   */
  sectionToggled(view, value, expanded) {
    this.showSections();
    this.note(`section ${value}: ${expanded ? "open" : "shut"}`);
  }

  openAllSections() {
    this.details.expandAll(true);
    this.showSections();
    this.note("opened every section");
  }

  shutAllSections() {
    this.details.expandAll(false);
    this.showSections();
    this.note("shut every section");
  }

  /** The open sections, in the order they are written. */
  showSections() {
    const open = this.details.sections
      .filter((section) => this.details.isExpanded(section.value))
      .map((section) => section.value);
    this.sections = open.join(" ") || "none";
  }

  // --- the lists ------------------------------------------------------------

  /**
   * The plain list, handed over by its outlet. An outlet is assigned on every
   * redraw, so filling it is guarded: the same view twice is the same list.
   *
   * @param {object} view The ListView.
   */
  set people(view) {
    if (this.peopleList === view) return;
    this.peopleList = view;

    view.content = SOME_PEOPLE;
    this.peopleCount = String(view.count);
  }

  get people() {
    return this.peopleList;
  }

  /**
   * The big one. Five thousand people go in; a dozen or so are ever drawn, and
   * the page says how many so that the difference is visible.
   *
   * @param {object} view The ProgressiveListView.
   */
  set crowd(view) {
    if (this.crowdList === view) return;
    this.crowdList = view;

    // The list works out what is on screen and says nothing about it, which is
    // right — nothing but this page cares. So the page listens in.
    const rangeChanged = view.visibleRangeChanged.bind(view);
    view.visibleRangeChanged = () => {
      rangeChanged();
      this.crowdDrawn = String(view.range.end - view.range.start);
    };

    view.content = aCrowd(5000);
    this.crowdCount = String(view.count);
  }

  get crowd() {
    return this.crowdList;
  }

  /** Empty the plain list, so it says what an empty list says. */
  emptyList() {
    this.people.removeAll();
    this.peopleCount = String(this.people.count);
    this.note("emptied the list");
  }

  /** And put them back. */
  fillList() {
    this.people.content = SOME_PEOPLE;
    this.peopleCount = String(this.people.count);
    this.note("filled the list");
  }

  /**
   * A load that runs long enough to be worth a spinner. One that answered
   * sooner would not show one at all, which is the point of the delay.
   */
  loadList() {
    this.people.removeAll();
    this.people.setLoading(true);
    this.peopleCount = "0";
    this.note("loading…");

    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      // Content is an answer: assigning it takes the spinner down.
      this.people.content = SOME_PEOPLE;
      this.peopleCount = String(this.people.count);
      this.note("loaded");
    }, 1200);
  }

  // --- the tabs -------------------------------------------------------------

  /**
   * A tab was chosen. The view says which and what it reads, so the page does
   * not have to keep a list of titles to look one up in.
   *
   * @param {object} view The TabView.
   * @param {number} index Which tab, counting from the first.
   * @param {string} title What that tab reads.
   */
  tabChosen(view, index, title) {
    this.tab = `${index}: ${title}`;
    this.note(`tab: ${title}`);
  }

  // --- the two bars ---------------------------------------------------------

  /**
   * A title bar button was pressed. A latching one reports its new state as
   * well, since that is what it is there to show.
   *
   * @param {object} button The TitleBarButton.
   */
  barButtonClicked(button) {
    this.bar = button.toggle
      ? `${button.text} (${button.on ? "on" : "off"})`
      : button.text;
    this.note(`title bar: ${this.bar}`);
  }

  /**
   * A toolbar item was worked — from the bar itself, or from the overflow menu,
   * which fires the item's own action rather than one of its own.
   *
   * @param {object} item The ToolBarItem.
   */
  toolClicked(item) {
    this.bar = item.text;
    this.note(`toolbar: ${item.text}`);
  }

  /**
   * A menu bar item's menu settled on a line. The item's action is what was
   * chosen, not the press that dropped the menu.
   *
   * @param {object} item The MenuBarItem.
   * @param {string} value The line that was chosen.
   */
  barMenuChose(item, value) {
    this.bar = `${item.text}: ${value}`;
    this.note(`menu bar: ${this.bar}`);
  }

  // --- the colour well ------------------------------------------------------

  /**
   * The well's action is the colour, not the press: pressing it opens its
   * chooser, and this is what the chooser settled on.
   *
   * @param {object} well The ColorWell.
   * @param {object} colour The colour it now holds.
   */
  wellColourChanged(well, colour) {
    this.wellColour =
      colour.alpha === 100
        ? colour.toHexString()
        : `${colour.toHexString()} at ${colour.alpha}%`;
    this.note(`colour well: ${this.wellColour}`);
  }

  // --- the popover ----------------------------------------------------------

  /**
   * Show the popover against the button that asked for it.
   *
   * `this.colours` is the popover's own controller — an outlet on a page that
   * has one hands that over rather than the element it drew — so this says
   * what the page has to say to it, and nothing about what is inside it.
   */
  /**
   * The side the popover should try first. It is a request rather than an
   * instruction: shown with no room on that side, the popover takes the
   * opposite one.
   *
   * @param {object} combo The ComboBox that changed.
   * @param {string} value One of PopOverOrientation.
   */
  orientationChanged(combo, value) {
    this.where = value;
    this.colours.orientation = value;
    this.note(`popover orientation: ${value}`);
  }

  showColours() {
    this.colours.onPick = (colour) => {
      this.picked = colour;
      this.note(`colour picked: ${colour}`);
    };
    this.colours.show(this.colourButton);
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

/** The people the plain list holds. */
const SOME_PEOPLE = [
  { name: "Ada Lovelace", worth: "1815" },
  { name: "Grace Hopper", worth: "1906" },
  { name: "Alan Turing", worth: "1912" },
  { name: "Katherine Johnson", worth: "1918" },
  { name: "Barbara Liskov", worth: "1939" },
];

/**
 * Enough people to make the point.
 *
 * @param {number} count how many.
 * @returns {object[]} them.
 */
function aCrowd(count) {
  return Array.from({ length: count }, (unused, index) => ({
    name: `Person ${index}`,
    worth: String(index),
  }));
}
