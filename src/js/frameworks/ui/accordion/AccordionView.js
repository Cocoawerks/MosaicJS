// AccordionView, ported from GWT Mosaic (client/components/AccordionPanel.java):
// a column of titled sections, each of which opens to show what is under it.
//
// Any number of them may be open at once — an accordion here is a set of
// disclosures sharing a column, not a set of tabs.
//
//   <AccordionView outlet="details" action="sectionToggled">
//       <AccordionSection title="Delivery" value="delivery" expanded="true">
//           <p>…</p>
//       </AccordionSection>
//       <AccordionSection title="Payment" value="payment">
//           <TextField/>
//       </AccordionSection>
//   </AccordionView>
import { coerceProps, Component } from "mosaic";

import AccordionSection from "./AccordionSection.js";
import "./accordion.css";

export default class AccordionView extends Component {
  constructor() {
    super();

    /**
     * The values of the sections that are open.
     *
     * A field rather than a setting: it is mutated in place, and what
     * follows a change is stated by the call to `needsDisplay()` beside it.
     *
     * @type {Set<string>}
     */
    this.expandedValues = new Set();

    /** Whether the markup's own `expanded` has been read. */
    this.awakened = false;
  }

  // --- the sections --------------------------------------------------------

  /**
   * The sections, as the markup stated them: read from the vnodes, so this is
   * where `expanded="true"` becomes true.
   */
  get sections() {
    const children = this.props.children;
    const list = Array.isArray(children) ? children.flat(Infinity) : [children];

    return list
      .filter((child) => child && child.type === AccordionSection)
      .map((child, index) => {
        const props = coerceProps(child.props);
        return {
          // A section is known by its value; failing that by its
          // title, and failing that by where it sits.
          value: String(props.value ?? props.title ?? index),
          props,
          vnode: child,
        };
      });
  }

  /**
   * Read what the markup said, once, at the first drawing — a component has
   * no props before then, and which sections are open is state this view goes
   * on to own.
   */
  awake() {
    if (this.awakened) return;
    this.awakened = true;

    for (const section of this.sections) {
      if (section.props.expanded === true)
        this.expandedValues.add(section.value);
    }
  }

  // --- opening and shutting ------------------------------------------------

  /** Whether the section carrying `value` is open. */
  isExpanded(value) {
    return this.expandedValues.has(value);
  }

  /**
   * Open the section carrying `value`, or shut it, and say whether that
   * counts as the user doing it.
   */
  setExpanded(value, expanded, fireEvents = false) {
    if (this.isExpanded(value) === expanded) return;

    if (expanded) this.expandedValues.add(value);
    else this.expandedValues.delete(value);
    this.needsDisplay();

    if (fireEvents) this.props.action?.(this.self, value, expanded);
  }

  /** Shut an open section, open a shut one. What a header does. */
  toggle(value) {
    this.setExpanded(value, !this.isExpanded(value), true);
  }

  /** Open every section, or shut every one — `expandAllSections` in Java. */
  expandAll(expanded = true) {
    for (const section of this.sections) {
      if (expanded) this.expandedValues.add(section.value);
      else this.expandedValues.delete(section.value);
    }
    this.needsDisplay();
  }

  // --- drawing -------------------------------------------------------------

  /**
   * The sections, each told whether it is open and how to report back. What
   * the markup said about a section is kept — that is the section's business.
   */
  drawSections() {
    return this.sections.map((section) => ({
      ...section.vnode,
      props: {
        ...section.props,
        key: section.value,
        value: section.value,
        accordion: this.self,
        expanded: this.isExpanded(section.value),
      },
    }));
  }

  draw() {
    this.awake();

    return <ul styleName="v-accordionPanel">{this.drawSections()}</ul>;
  }
}
