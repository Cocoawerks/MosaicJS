// ListItem, ported from GWT Mosaic (client/components/ListItem.java): one row of
// a list, and what that row is worth.
//
// The Java version is abstract and builds a widget from its datum:
//
//   class PersonItem extends ListItem<Person> {
//       protected Widget build(Person p) { return new Label(p.name); }
//   }
//
// Here a row draws itself, which is what every other component does — so the
// same thing is said by overriding `draw`:
//
//   export default class PersonItem extends ListItem {
//       draw() {
//           return <div styleName="person">{this.content.name}</div>;
//       }
//   }
//
// and the list is told which kind of row it holds by being given one:
//
//   <ListView outlet="people" emptyText="Nobody here">
//       <PersonItem/>
//   </ListView>
import { Component } from "mosaic";

import "./list.css";

export default class ListItem extends Component {
  static props = {
    /** Where this row sits in the list. */
    index: { type: Number, default: 0 },
  };

  /** The datum this row is worth — whatever the list was given. */
  get content() {
    return this.get("content", null);
  }

  /** Everything the list holds, for a row that has to know its neighbours. */
  get list() {
    return this.get("list", []);
  }

  /** The list this row belongs to, handed down as it is drawn. */
  get listView() {
    return this.get("listView", null);
  }

  /**
   * A row with nothing said about it reads as its datum does. A list worth
   * looking at overrides this.
   */
  draw() {
    return <div styleName="v-ListItem-text">{String(this.content ?? "")}</div>;
  }
}
