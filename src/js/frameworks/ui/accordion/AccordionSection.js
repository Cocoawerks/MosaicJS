// AccordionSection, ported from GWT Mosaic
// (client/components/AccordionSection.java + its AccordionSection.ui.xml
// template): one titled section of an accordion, and what is under it.
//
// A section does not own whether it is open — the view does, and says so through
// props — so pressing its header asks the view rather than deciding for itself.
// That is the arrangement RadioGroup, OutlineView and Menu already use here; the
// Java version keeps the state on the section, which is the same thing said the
// other way round.
import { Component } from "mosaic";

import "./accordion.css";

// The chevron, which the sheet turns when the section opens — what
// SvgIconLibrary.getIcon("svg:chevron-down") hands the Java version.
import ChevronDown from "svg:chevron-down";

/** Ids for the parts that name each other, unique per document. */
let nextId = 0;

export default class AccordionSection extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `AccordionSection`. See Component.styleName.
   */
  static styleName = "v-accordionSection";

  static props = {
    /** The heading on the section's own line. */
    title: { type: String, default: "" },
    /** What the view reports when this section is opened or closed. */
    value: { type: String, default: "" },

    // --- what the view says ----------------------------------------------

    /** Whether it is open. */
    expanded: { type: Boolean, default: false },
  };

  constructor() {
    super();

    const id = ++nextId;
    /** The header and what it opens name each other, so both need an id. */
    this.titleId = `mosaic-accordion-title-${id}`;
    this.contentId = `mosaic-accordion-content-${id}`;
  }

  /** The view this section belongs to, handed down as it is drawn. */
  get accordion() {
    return this.get("accordion", null);
  }

  // --- behaviour -----------------------------------------------------------

  /** The header is what opens and shuts a section; its contents are not. */
  click(event) {
    if (!this.headerNode?.contains?.(event.target)) return;
    this.accordion?.toggle(this.value);
  }

  /**
   * A press on the header must not take a selection with it — the Java
   * version cancels the mousedown for the same reason.
   */
  pointerDown(event) {
    if (this.headerNode?.contains?.(event.target)) event.preventDefault?.();
  }

  /** The space bar works the header, as it works a button. */
  keyDown(event) {
    if (event.key !== " " && event.key !== "Spacebar" && event.key !== "Enter")
      return;
    if (!this.headerNode?.contains?.(event.target)) return;
    event.preventDefault?.();
    this.accordion?.toggle(this.value);
  }

  // --- drawing -------------------------------------------------------------

  draw() {
    const expanded = this.expanded;

    return (
      <li styleName={["v-accordionSection", expanded ? "expanded" : null]}>
        <div
          styleName="header"
          ref={(el) => (this.headerNode = el)}
          role="button"
          tabindex="0"
          aria-expanded={String(expanded)}
          aria-labelledby={this.titleId}
          aria-controls={this.contentId}
        >
          <span id={this.titleId}>{this.title}</span>
          <div styleName="accordion-state-icon" aria-hidden="true">
            <ChevronDown />
          </div>
        </div>

        <div styleName="form" id={this.contentId} role="region">
          {this.props.children}
        </div>
      </li>
    );
  }
}
