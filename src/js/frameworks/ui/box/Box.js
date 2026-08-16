// Box, ported from GWT Mosaic (client/components/Box.java): a titled group, in
// the manner of Cocoa's NSBox — a bordered region with its title straddling the
// top edge, holding whatever belongs together.
//
//   <Box title="Colours">
//       <ColorWell color="#3584e4"/>
//       <ColorWell color="#e01b24"/>
//   </Box>
import { Component } from "mosaic";

import "./box.css";

export default class Box extends Component {
  static props = {
    /** The heading. A box with none is drawn without one. */
    title: { type: String, default: "" },
  };

  draw() {
    const title = this.title;

    return (
      <div styleName="v-Box" role="group" aria-label={title || null}>
        <span
          styleName="v-Box-title"
          style={{ display: title ? null : "none" }}
          aria-hidden={title ? null : "true"}
        >
          {title}
        </span>

        <div styleName="v-Box-content">{this.props.children}</div>
      </div>
    );
  }
}
