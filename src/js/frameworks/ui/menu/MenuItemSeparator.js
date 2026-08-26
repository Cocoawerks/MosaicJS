// MenuItemSeparator: the rule drawn between groups of menu items.
//
//   <Menu>
//       <MenuItem text="Cut" value="cut"/>
//       <MenuItem text="Copy" value="copy"/>
//       <MenuItemSeparator/>
//       <MenuItem text="Paste" value="paste"/>
//   </Menu>
//
// A MenuItem subclass that turns off `canBeActive`, wears `v-MenuItem-Separator`
// and calls itself a separator to a reader — what it *is* rather than a setting
// on something else, so a rule is written as a rule.
//
// `<MenuItem separator="true"/>` still says the same thing and is what the
// framework used before this, so both work — see {@link MenuItem#separator}.
import MenuItem from "./MenuItem.js";
import "./menu.css";

export default class MenuItemSeparator extends MenuItem {
  static props = {
    /**
     * Always: a separator is one by being one. Declared so the menu reading
     * its vnode's props finds it stated there, as it would on an item that
     * asked to be a rule.
     */
    separator: { type: Boolean, default: true },
  };

  /**
   * A rule is not a line anything can be done with — `canBeActive = false` in
   * the constructor of the Java version. Its base already says this for
   * anything wearing `separator`; it is said again here because for this class
   * it is not a setting that could be turned off.
   */
  get canBeActive() {
    return false;
  }
}
