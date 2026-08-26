// Option: one entry in a ComboBox.
//
// A component that draws a DOM `<option>`, so a ComboBox states its entries the
// way the markup reads:
//
//   <ComboBox outlet="colour" action="colourChanged">
//       <Option text="Red" value="red"/>
//       <Option text="Green" value="green"/>
//   </ComboBox>
import { Component } from "mosaic";

export default class Option extends Component {
  static properties = {
    /** Whether the entry can be chosen. */
    enabled: { type: Boolean, default: true },
  };

  /** What the entry reads. Falls back to the value, as a bare `<option>` does. */
  get text() {
    return this.get("text", null) ?? this.value;
  }

  set text(value) {
    this.set("text", value);
  }

  /** What the ComboBox reports when this entry is chosen. */
  get value() {
    return this.get("value", "");
  }

  set value(value) {
    this.set("value", value ?? "");
  }

  draw() {
    // `disabled` is dropped by the runtime when null, which is how the Java
    // version leaves the attribute off rather than setting it false.
    return (
      <option value={this.value} disabled={this.enabled ? null : "true"}>
        {this.text}
      </option>
    );
  }
}
