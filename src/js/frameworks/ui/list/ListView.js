// ListView, ported from GWT Mosaic (client/components/ListView.java): a
// scrolling list of rows, one per thing it was given.
//
// The Java version is abstract over two types — the datum and the row — and an
// application implements `createItem`. Here the row is a component, and the
// list is told which kind by being given one in its markup:
//
//   <ListView outlet="people" emptyText="Nobody here">
//       <PersonItem/>
//   </ListView>
//
// The list draws one of those per datum, handing each its own. Code that would
// rather say it in JavaScript passes the class as `item`.
import {Component} from "mosaic";

import LoadingIndicator from "../controls/loading/LoadingIndicator.js";
import ListItem from "./ListItem.js";
import "./list.css";

/**
 * How long a load runs before its spinner appears. A query that answers sooner
 * never flashes one, and a caller re-arming a load on every keystroke only ever
 * starts one spin.
 */
const LOADING_DELAY = 180;

export default class ListView extends Component {
    static props = {
        /** What the list says when it holds nothing. */
        emptyText: {type: String, default: ""},
    };

    constructor() {
        super();

        /** What the list holds. */
        this.items = [];

        /** Whether a load has been asked for, spinner shown or not. */
        this.loading = false;

        /** Whether the spinner is actually up. */
        this.spinning = false;
    }

    // --- what it holds -------------------------------------------------------

    /** Everything in the list. Assigning replaces the lot. */
    get content() {
        return this.items;
    }

    set content(items) {
        this.setLoading(false);
        this.items = Array.isArray(items) ? items : [];
        this.needsDisplay();
    }

    /** How many there are. */
    get count() {
        return this.items.length;
    }

    add(item) {
        this.items = [...this.items, item];
        this.needsDisplay();
    }

    remove(item) {
        this.items = this.items.filter((held) => held !== item);
        this.needsDisplay();
    }

    removeAll() {
        this.items = [];
        this.needsDisplay();
    }

    // --- while it is waiting -------------------------------------------------

    /**
     * Say a load is running, or has finished. The spinner waits a moment before
     * it appears, so a quick answer never flashes one.
     */
    setLoading(loading) {
        const wanted = this.bool(loading);
        if (this.loading === wanted) return;
        this.loading = wanted;

        clearTimeout(this.loadingTimer);
        this.loadingTimer = null;

        if (!wanted) {
            this.showSpinner(false);
            return;
        }
        this.loadingTimer = setTimeout(() => {
            this.loadingTimer = null;
            this.showSpinner(true);
        }, LOADING_DELAY);
    }

    get isLoading() {
        return this.loading;
    }

    showSpinner(spinning) {
        if (this.spinning === spinning) return;
        this.spinning = spinning;
        this.needsDisplay();
    }

    detached() {
        clearTimeout(this.loadingTimer);
        this.loadingTimer = null;
    }

    // --- the rows ------------------------------------------------------------

    /**
     * The kind of row this list holds: the component given in its markup, or
     * named as `item`, and a plain ListItem when neither says otherwise.
     */
    get itemType() {
        const stated = this.props.item;
        if (typeof stated === "function") return stated;

        const children = this.props.children;
        const list = Array.isArray(children) ? children.flat(Infinity) : [children];
        const template = list.find((child) => child && typeof child.type === "function");
        return template?.type ?? ListItem;
    }

    /** What the markup said about that row, kept for every one of them. */
    get itemProps() {
        const children = this.props.children;
        const list = Array.isArray(children) ? children.flat(Infinity) : [children];
        return list.find((child) => child && typeof child.type === "function")?.props ?? {};
    }

    /** The rows to draw: every datum, unless a subclass narrows the range. */
    get range() {
        return {start: 0, end: this.items.length};
    }

    /**
     * One row, drawn by the kind of component this list holds and wrapped in the
     * line the sheet lays out — `v-List-item` is the wrapper the Java version
     * puts that class on.
     *
     * No `key`. A key is what tells the runtime that the node at a position is
     * not the node that was there before, and rows are the one case where that
     * is never true: a row is a slot the list pours a datum into, and the datum
     * at a slot changing is a patch, not a new row. Keyed by index it would be
     * the opposite — a progressive list draws a window whose indices all shift
     * by one as it scrolls, so every row would count as new and the whole window
     * would be rebuilt for one row of movement.
     */
    drawItem(item, index, style = null) {
        const Item = this.itemType;

        return (
            <div styleName="v-List-item" style={style} role="option">
                <Item
                    {...this.itemProps}
                    content={item}
                    index={index}
                    list={this.items}
                    listView={this.self}
                />
            </div>
        );
    }

    /** What is inside the scroller: the spinner, the message, or the rows. */
    drawContent() {
        if (this.spinning) {
            return <LoadingIndicator size="medium" styleName="v-ListLoading"/>;
        }

        if (this.items.length === 0) {
            return <span styleName="v-List-empty-text">{this.emptyText}</span>;
        }

        const {start, end} = this.range;
        const rows = [];
        for (let index = start; index < end; index++) {
            rows.push(this.drawItem(this.items[index], index));
        }
        return <div role="none">{rows}</div>;
    }

    /** Classes the list wears, which say what state it is in. */
    listClasses() {
        return [
            "v-List",
            this.spinning ? "loading" : null,
            !this.spinning && this.items.length === 0 ? "empty" : null,
        ];
    }

    draw() {
        return (
            <div styleName={this.listClasses()} role="listbox">
                <div styleName="scroller" ref={(el) => (this.scroller = el)}>
                    {this.drawContent()}
                </div>
            </div>
        );
    }
}
