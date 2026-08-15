// One row of the KitchenSink's lists.
//
// A row is a component and draws itself, which is what `ListItem` is for: the
// list is told what kind of row it holds by being given one of these, and hands
// each the datum it stands for.
import { ListItem } from "mosaic/frameworks/ui";

import "./person.css";

export default class PersonItem extends ListItem {
  draw() {
    const person = this.content;

    return (
      <div styleName="person">
        <span styleName="name">{person.name}</span>
        <span styleName="worth">{person.worth}</span>
      </div>
    );
  }
}
