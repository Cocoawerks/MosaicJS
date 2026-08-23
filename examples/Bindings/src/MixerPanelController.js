/**
 * The controller behind MixerPanel.ib.xml.
 *
 * Almost nothing: the two `<Bind/>` tags in the markup are what fill `level`
 * and drive the meter, so this holds the state and does not maintain it. There
 * is no handler here, and no method named by an action — the joins are in the
 * file beside the controls they join.
 */
export default class MixerPanelController {
  constructor() {
    /** @type {string} What the tag called this panel. */
    this.title = "Mixer";

    /**
     * @type {number} What the knob is worth. A `<Bind/>` assigns it, and the
     * `{level}` in the markup reads it — a binding watches the property it
     * reads, so the number on screen follows the knob with nothing else
     * written anywhere.
     */
    this.level = 35;
  }
}
