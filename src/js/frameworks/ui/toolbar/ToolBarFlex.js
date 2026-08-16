// ToolBarFlex — `ToolBar.addFlex()` said as markup: a gap that takes whatever
// room is going, so the items after it are pushed to the trailing edge.
//
//   <ToolBar>
//       <ToolBarItem text="New" action="newDocument"/>
//       <ToolBarFlex/>
//       <ToolBarItem text="Share" action="share"/>
//   </ToolBar>
//
// The bar's own sheet is imported here as well as by the bar: a stylesheet is
// scoped to the module that imports it, and this gap is this module's drawing.
import {Component} from "mosaic";

import "./toolbar.css";

export default class ToolBarFlex extends Component {
    draw() {
        return <div styleName="v-ToolBar-flex" aria-hidden="true"/>;
    }
}
