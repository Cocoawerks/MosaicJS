// MenuItem, ported from GWT Mosaic (client/components/MenuItem.java + its
// MenuItem.ui.xml template): one line of a menu.
//
// An item does not own whether it is the active one — the menu does, and says
// so through props — so pointing at one asks the menu rather than deciding for
// itself. That is the same arrangement as the Java version, where
// `menu.setActiveItem(this)` is what a pointer entering an item does.
import Control from "../controls/Control.js";
import "./menu.css";

// The chevron shown on an item that opens a menu of its own — what
// SvgIconLibrary.getIcon("svg:chevron-right") hands the Java version.
import ChevronRight from "svg:chevron-right";

export default class MenuItem extends Control {
    static props = {
        /** What the line reads. */
        text: {type: String, default: ""},
        /** What the menu reports when this line is chosen. */
        value: {type: String, default: ""},
        /** A font-icon class name, or an icon component, drawn before it. */
        icon: {type: String},
        /** Whether it is a rule between items rather than an item. */
        separator: {type: Boolean, default: false},

        // --- what the menu says --------------------------------------------

        /** Whether the pointer or the keyboard is on this line. */
        active: {type: Boolean, default: false},
        /**
         * Whether it opens a menu of its own, which draws the chevron the Java
         * version draws. A menu *of* a menu is not ported: what an item with
         * one does is its own to arrange.
         */
        expandable: {type: Boolean, default: false},
    };

    /** The menu this item belongs to, handed down as it is drawn. */
    get menu() {
        return this.get("menu", null);
    }

    /** A rule is not a line anything can be done with. */
    get canBeActive() {
        return !this.separator && this.enabled;
    }

    // --- behaviour -----------------------------------------------------------

    /** The pointer arrived: the menu is what decides what that means. */
    pointerEnter() {
        if (!this.canBeActive) return;
        this.menu?.activate(this.value);
    }

    /**
     * And left. An item holding a menu of its own keeps it while the pointer is
     * over that menu — the Java version tests the submenu's box for the same
     * reason — so only an item without one goes quiet here.
     */
    pointerLeave(event) {
        if (this.expandable && this.menu?.pointerIsInSubmenu?.(this.value, event)) return;
        this.menu?.activate(null);
    }

    click(event) {
        event.stopPropagation?.();
        if (!this.canBeActive) return;
        this.menu?.choose(this.value);
    }

    // --- drawing -------------------------------------------------------------

    /** An icon may be a class name or a component, as a Button's may. */
    drawIcon() {
        const icon = this.icon;
        if (!icon) return <i styleName="icon" aria-hidden="true"/>;

        if (typeof icon === "function") {
            const Icon = icon;
            return (
                <i styleName="icon">
                    <Icon aria-hidden="true"/>
                </i>
            );
        }
        return <i styleName={["icon", icon]} aria-hidden="true"/>;
    }

    draw() {
        if (this.separator) {
            return <li styleName={["v-MenuItem", "v-MenuItem-Separator"]} role="separator"/>;
        }

        // An item with an icon says so, and one without says nothing: the
        // sheet's `.noIcon` rule indents a label by 36px, and the Java version
        // never puts that class on an item.
        return (
            <li
                styleName={[
                    "v-MenuItem",
                    this.icon ? "hasIcon" : null,
                    this.active ? "active" : null,
                    ...this.controlClasses(),
                ]}
                role="menuitem"
                data-item={this.value}
                tabindex={null}
                aria-disabled={this.enabled ? null : "true"}
                aria-haspopup={this.expandable ? "menu" : null}
            >
                {this.drawIcon()}
                <span>{this.text}</span>
                <i
                    styleName={["icon", "submenu-indicator"]}
                    style={{display: this.expandable ? "block" : "none"}}
                    aria-hidden="true"
                >
                    <ChevronRight/>
                </i>
            </li>
        );
    }
}
