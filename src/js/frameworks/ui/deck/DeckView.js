// DeckView: a stack of cards of which one is on top.
//
// Every card is drawn and stays drawn — the ones that are not showing are
// hidden rather than thrown away, so a field half filled in on another card
// still holds what was typed when it comes back round. That is the whole
// difference between a deck and simply drawing whichever card is wanted.
import { Component } from "mosaic";

import "./deck.css";

export default class DeckView extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `DeckView`. See Component.primaryStyleName.
   */
  static primaryStyleName = "v-Deck";

  static properties = {
    /** Which card is on top, counting from the first. */
    selectedIndex: { type: Number, default: 0 },
  };

  /** The cards, as the markup stated them. */
  get cards() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];
    return list.filter(Boolean);
  }

  /** How many there are. `getWidgetCount()` in Java. */
  get count() {
    return this.cards.length;
  }

  /**
   * Show the card at `index`, and say whether that counts as the user turning
   * to it. `showWidget(int)` in Java, which says nothing to anyone.
   *
   * @param {number} index Which card, counting from the first.
   * @param {boolean} fireEvents Whether to fire the action.
   */
  show(index, fireEvents = false) {
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= this.count) return;
    if (next === this.selectedIndex) return;

    this.selectedIndex = next;
    if (fireEvents) this.props.action?.(this.self, next);
  }

  draw() {
    const showing = this.selectedIndex;

    return (
      <div styleName="v-Deck">
        {this.cards.map((card, index) => (
          <div
            key={index}
            styleName={["v-Deck-card", index === showing ? "is-showing" : null]}
            aria-hidden={index === showing ? null : "true"}
            inert={index === showing ? null : ""}
          >
            {card}
          </div>
        ))}
      </div>
    );
  }
}
