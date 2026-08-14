// Tab, the counterpart of the `<c:tab title="…">` a TabPanel takes in UiBinder:
// one tab's title, and what is under it.
//
// It draws nothing of its own. A TabView reads the title off it for the bar and
// hands what it holds to the deck below, exactly as Option is read by ComboBox
// and OutlineItem by OutlineView.
import {Component} from "mosaic";

export default class Tab extends Component {
    static props = {
        /** What the tab reads in the bar. */
        title: {type: String, default: ""},
    };

    /**
     * A tab is never drawn: the view draws the bar and the deck, and what a tab
     * holds is drawn as a card of that deck.
     */
    draw() {
        return null;
    }
}
