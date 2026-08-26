// TabView: a bar of tabs over a deck of cards, with a pill that slides behind
// whichever tab is chosen.
// In markup the tabs are the nesting, each with what belongs under it:
//   <TabView outlet="tabs" action="tabChanged">
//       <Tab title="Overview">
//           <p>…</p>
//       </Tab>
//       <Tab title="Details">
//           <TextField placeholder="Anything typed here survives a switch"/>
//       </Tab>
//   </TabView>
import { Component } from "mosaic";

import DeckView from "../deck/DeckView.js";
import Tab from "./Tab.js";
import "./tab.css";

/**
 * @fires TabView#change — the selected tab changed; the handler is given the
 *   tab view, the new index and its title. Bound bare: `action="method"`
 *   (`onChange` in JS).
 */
export default class TabView extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `TabView`. See Component.primaryStyleName.
   */
  static primaryStyleName = "v-TabPanel";

  static properties = {
    /** Which tab is chosen, counting from the first. */
    selectedIndex: { type: Number, default: 0 },
  };

  constructor(props) {
    super(props);

    /**
     * Whether the pill should slide to where it is going.
     *
     * Only the user moves it: a click or an arrow key slides it, and
     * everything else — the first placement, a bar that changed size, a
     * tab chosen in code — puts it there without a journey, since it was
     * never anywhere to travel from.
     */
    this.sliding = false;
  }

  // --- the tabs ------------------------------------------------------------

  /** The tabs, as the markup stated them. */
  get tabs() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter((child) => child && child.type === Tab);
  }

  /** How many there are. `getNumberOfTabs()` in Java. */
  get count() {
    return this.tabs.length;
  }

  /**
   * Choose the tab at `index`, and say whether that counts as the user
   * choosing it — which is also what decides whether the pill slides.
   *
   * @param {number} index Which tab, counting from the first.
   * @param {boolean} fireEvents Whether to fire the action.
   */
  selectTab(index, fireEvents = false) {
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= this.count) return;
    if (next === this.selectedIndex) return;

    this.sliding = fireEvents;
    this.selectedIndex = next;
    this.movePill();
    this.sliding = false;

    if (fireEvents)
      this.props.action?.(this.self, next, this.tabs[next].props.title);
  }

  // --- behaviour -----------------------------------------------------------

  /** A tab was clicked: which one is what it says. */
  click(event) {
    const button = event.target?.closest?.("[data-tab]");
    if (!button) return;
    this.selectTab(Number(button.getAttribute("data-tab")), true);
  }

  /**
   * A press on the bar chooses a tab and nothing else — it must not take the
   * selection with it, which is what a press on text does.
   */
  pointerDown(event) {
    if (event.target?.closest?.(".v-TabBar")) event.preventDefault?.();
  }

  /** The arrows move along the bar, and stop at either end. */
  keyDown(event) {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;

    event.preventDefault?.();
    this.selectTab(this.selectedIndex + step, true);
  }

  // --- the pill ------------------------------------------------------------

  /**
   * Put the pill behind the chosen tab, matching where that tab sits and how
   * wide it is — the tabs share the bar between them, so both change with it.
   *
   * Written to the element rather than drawn: it is measured from the page and
   * settled after layout, and drawing it would mean a redraw per frame of the
   * slide.
   */
  movePill() {
    const pill = this.pillNode;
    const button = this.barNode?.querySelector(
      `[data-tab="${this.selectedIndex}"]`,
    );
    if (!pill || !button) return;

    // The class is left on except for the moment a slide needs it off: it
    // starts set, so the first placement — from nowhere to the first tab —
    // cannot slide in from the corner.
    pill.classList.toggle("no-anim", !this.sliding);
    pill.style.left = `${button.offsetLeft}px`;
    pill.style.top = `${button.offsetTop}px`;
    pill.style.width = `${button.offsetWidth}px`;
  }

  /**
   * Once it is on screen the pill can be placed, and placed again whenever the
   * bar changes size: a bar that is laid out later — inside a dialog that has
   * yet to open, or a card of another deck — has nothing to measure until it
   * is, and the first placement would land at nothing, nowhere.
   */
  attached() {
    this.movePill();

    if (typeof ResizeObserver !== "function") return;
    this.watcher = new ResizeObserver(() => this.movePill());
    this.watcher.observe(this.barNode);
  }

  detached() {
    this.watcher?.disconnect();
    this.watcher = null;
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The bar: the pill first, so it sits behind the tabs that follow it, then
   * a tab for each title. What a tab holds is not drawn here — that is the
   * deck's, below.
   *
   * The pill is drawn without `no-anim`. That class is `movePill`'s to put on
   * and take off, and it has to stay off for the whole frame a slide starts
   * in. Drawn, every redraw put it back — and the action a click fires is a
   * redraw, landing between the slide being set up and the browser painting
   * it, which left the pill jumping instead of sliding.
   */
  drawBar() {
    return (
      <div
        styleName="v-TabBar"
        ref={(el) => (this.barNode = el)}
        role="tablist"
        tabindex="0"
      >
        <div
          styleName="v-TabBar-indicator"
          ref={(el) => (this.pillNode = el)}
          aria-hidden="true"
        />

        {this.tabs.map((tab, index) => (
          <div
            key={index}
            data-tab={index}
            styleName={[
              "v-TabButton",
              index === this.selectedIndex ? "is-selected" : null,
            ]}
            role="tab"
            aria-selected={String(index === this.selectedIndex)}
          >
            {tab.props.title}
          </div>
        ))}
      </div>
    );
  }

  draw() {
    return (
      <div styleName="v-TabPanel">
        {this.drawBar()}

        <DeckView
          selectedIndex={this.selectedIndex}
          ref={(view) => (this.deck = view)}
        >
          {this.tabs.map((tab) => tab.children)}
        </DeckView>
      </div>
    );
  }
}
