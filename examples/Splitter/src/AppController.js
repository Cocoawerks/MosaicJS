/**
 * The controller behind `main.mib`.
 *
 * Two SplitViews are driven from here through their outlets: the bar's buttons
 * say what to do to them, and each view reports back the length its divider was
 * dragged to, which the status line shows.
 */
import { setTheme, theme } from "mosaic/frameworks/ui";

export default class AppController {
  constructor() {
    /** @type {string} The heading the bar shows. */
    this.title = "Splitter";

    /**
     * The two lengths, as the status line reads them. Assigning to one updates
     * the line, because binding to a property is what makes it observed.
     */
    this.sidebarWidth = "220";
    this.previewHeight = "240";

    /** @type {string} What was last done, in the page's own words. */
    this.note = "drag either divider";

    /** @type {string} The theme the page is wearing. */
    this.theme = theme;
  }

  // --- the sidebar -----------------------------------------------------------

  /**
   * Shut the sidebar away, or bring it back. The view remembers how wide it
   * was, so it comes back where the reader left it rather than at some default.
   */
  toggleSidebar() {
    this.sidebarSplit.toggle();

    const shut = this.sidebarSplit.collapsed;
    this.collapseButton.text = shut ? "Show the sidebar" : "Hide the sidebar";
    this.sidebarWidth = String(Math.round(this.sidebarSplit.paneLength));
    this.note = shut ? "the sidebar is shut away" : "the sidebar is back";
  }

  /**
   * Turn the outer view on its side. The panes keep everything else — which
   * one stretches, how long the other is, what is in them.
   */
  toggleOrientation() {
    const down = this.sidebarSplit.orientation === "vertical";
    this.sidebarSplit.orientation = down ? "horizontal" : "vertical";
    // The length was written to the panes for the old orientation; laying out
    // again writes it to the axis that now matters.
    this.sidebarSplit.layout();

    this.orientationButton.text = down
      ? "Lay it out the other way"
      : "Put it back side by side";
    this.note = down ? "panes side by side" : "panes one above the other";
  }

  /**
   * How thick the divider is. A hairline has no sash to take hold of, so it
   * lights up under the pointer instead.
   *
   * @param {object} combo The ComboBox that changed.
   * @param {string} value The thickness, in pixels.
   */
  thicknessChanged(combo, value) {
    this.sidebarSplit.dividerThickness = value;
    this.previewSplit.dividerThickness = value;
    // Both views have to place their panes again: the divider between them
    // just changed how much room it takes.
    this.sidebarSplit.layout();
    this.previewSplit.layout();
    this.note = `divider is ${value}px`;
  }

  // --- what the views report back -------------------------------------------

  /**
   * A divider was dragged. The view passes the length it settled on, already
   * clamped to the bounds the markup gave it.
   *
   * @param {object} view The SplitView that was dragged.
   * @param {number} length How long its static pane now is.
   */
  sidebarResized(view, length) {
    this.sidebarWidth = String(Math.round(length));
    this.note = "dragging the sidebar";
  }

  previewResized(view, length) {
    this.previewHeight = String(Math.round(length));
    this.note = "dragging the preview";
  }

  // --- the theme -------------------------------------------------------------

  /**
   * @param {object} combo The ComboBox that fired.
   * @param {string} value The theme chosen.
   */
  themeChanged(combo, value) {
    this.theme = setTheme(value);
    this.note = `theme: ${value}`;
  }
}
