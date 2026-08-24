// ColorChooserPanel, ported from GWT Mosaic
// (client/components/ColorChooserPanel.java): a palette of presets above, and
// below it a saturation/brightness square with a hue strip beside it, an
// opacity slider, and a hex entry with a preview.
//
// The Java version draws the two pickers on `Canvas` widgets and paints them
// through CanvasGraphics. Here they are `<canvas>` elements the component draws
// on itself: the painting is the same arithmetic, without a widget in between.
import { Component } from "mosaic";

import Slider from "../slider/Slider.js";
import TextField from "../text/TextField.js";
import Color from "./Color.js";
import "./colorchooser.css";

/**
 * The GTK4 / GNOME Adwaita palette the Java version carries: nine families
 * across, five shades down, light to dark.
 */
const PALETTE_COLUMNS = 9;
const PALETTE = [
  0x99c1f1, 0x8ff0a4, 0xf9f06b, 0xffbe6f, 0xf66151, 0xdc8add, 0xcdab8f,
  0xffffff, 0x77767b, 0x62a0ea, 0x57e389, 0xf8e45c, 0xffa348, 0xed333b,
  0xc061cb, 0xb5835a, 0xf6f5f4, 0x5e5c64, 0x3584e4, 0x33d17a, 0xf6d32d,
  0xff7800, 0xe01b24, 0x9141ac, 0x986a44, 0xdeddda, 0x3d3846, 0x1c71d8,
  0x2ec27e, 0xf5c211, 0xe66100, 0xc01c28, 0x813d9c, 0x865e3c, 0xc0bfbc,
  0x241f31, 0x1a5fb4, 0x26a269, 0xe5a50a, 0xa51d2d, 0x8d1a1a, 0x613583,
  0x63452c, 0x9a9996, 0x000000,
];

/** A number held between 0 and 1. */
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export default class ColorChooserPanel extends Component {
  constructor() {
    super();

    /** The colour it is showing. */
    this.current = Color.white();

    /**
     * The hue, saturation and brightness being worked, each 0–1.
     *
     * Kept beside the colour rather than read back out of it: every grey
     * reports a hue of 0, which would snap the strip to red the moment a
     * drag reached the left-hand edge of the square.
     */
    this.hue = 0;
    this.saturation = 0;
    this.brightness = 1;

    /** Whether a canvas is being dragged, and which. */
    this.dragging = null;

    /** Whether the markup's `color` has been read. */
    this.awakened = false;
  }

  // --- the colour ----------------------------------------------------------

  get color() {
    return this.current;
  }

  set color(value) {
    this.setColor(value, false);
  }

  /**
   * Show `color`, and say whether that counts as the user choosing it.
   *
   * @param {Color} color What to show.
   * @param {boolean} fireEvents Whether to tell whoever is listening.
   */
  setColor(color, fireEvents = true) {
    if (!color) return;

    this.current = color;
    const hsb = color.toHSB();
    // A grey has no hue of its own; the one being worked is kept.
    if (hsb.saturation !== 0) this.hue = hsb.hue;
    this.saturation = hsb.saturation;
    this.brightness = hsb.brightness;

    this.needsDisplay();
    this.paint();
    // As in ColorWell: the colour lives in a field, so `color` is never
    // assigned and a binding onto it would never hear the user pick one.
    this.changed("color");
    if (fireEvents) {
      // `action="…"` is what a page names in markup; `onColor` is what a
      // component that built this panel itself passes instead, since an
      // action is a method's name and a component has a function.
      this.props.action?.(this.self, color);
      this.props.onColor?.(this.self, color);
    }
  }

  /**
   * Say the colour was chosen outright — a palette swatch, or Enter in the hex
   * field. Dragging the square or the strip streams values; this is a commit,
   * so whatever hosts the panel can put itself away.
   */
  firePicked() {
    this.props.onPicked?.(this.self, this.current);
  }

  /** Put the keyboard on the first thing that takes it: the opacity slider. */
  focusFirstControl() {
    this.node?.querySelector(".handle")?.focus?.();
  }

  // --- what the markup said ------------------------------------------------

  /**
   * Read what the markup said, once, at the first drawing — a component has
   * no props before then, and what is read here is state it goes on to own,
   * so reading it again on a later drawing would undo whatever has happened
   * to it since.
   */
  awake() {
    if (this.awakened) return;
    this.awakened = true;

    const stated = this.props.color;
    const color =
      stated instanceof Color
        ? stated
        : (Color.fromHex(stated ?? "") ?? Color.white());
    this.current = color;
    const hsb = color.toHSB();
    this.hue = hsb.hue;
    this.saturation = hsb.saturation;
    this.brightness = hsb.brightness;
  }

  // --- working the pickers -------------------------------------------------

  /**
   * The two canvases are drawn by this component, so what a press means is
   * settled by which one it landed on. One listener on the panel rather than
   * one per canvas, as the sliders do.
   */
  pointerDown(event) {
    const canvas = this.canvasUnder(event.target);
    if (!canvas) return;

    event.preventDefault?.();
    this.dragging = canvas;
    try {
      event.target.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer has already gone; the drag carries on without capture.
    }
    this.pickFrom(canvas, event);
  }

  pointerMove(event) {
    if (this.dragging) this.pickFrom(this.dragging, event);
  }

  pointerUp(event) {
    if (!this.dragging) return;
    try {
      event.target.releasePointerCapture?.(event.pointerId);
    } catch {
      // Nothing was captured, so there is nothing to give back.
    }
    this.dragging = null;
  }

  /** Which picker a node belongs to, or null when it is neither. */
  canvasUnder(node) {
    if (node === this.svCanvas) return "sv";
    if (node === this.hueCanvas) return "hue";
    return null;
  }

  /** Read a colour out of where the pointer is on a picker. */
  pickFrom(which, event) {
    const canvas = which === "sv" ? this.svCanvas : this.hueCanvas;
    if (!canvas) return;

    const box = canvas.getBoundingClientRect();
    if (which === "sv") {
      const saturation = clamp01(
        (event.clientX - box.left) / Math.max(1, box.width - 1),
      );
      const brightness =
        1 - clamp01((event.clientY - box.top) / Math.max(1, box.height - 1));
      this.saturation = saturation;
      this.brightness = brightness;
    } else {
      let hue = clamp01((event.clientY - box.top) / Math.max(1, box.height));
      // Hue comes round again at 1, so it is held just short of it and the
      // bottom of the strip stays the red it looks like rather than the
      // red it would wrap to.
      if (hue >= 1) hue = (box.height - 1) / box.height;
      this.hue = hue;
    }

    this.setColor(
      Color.fromHSB(
        this.hue,
        this.saturation,
        this.brightness,
        this.current.alpha,
      ),
    );
  }

  // --- the controls beside them --------------------------------------------

  /** A palette swatch: a colour, and a commit. */
  pickSwatch(rgb) {
    this.setColor(Color.fromRGB(rgb, this.current.alpha));
    this.firePicked();
  }

  /** The opacity slider moved. */
  alphaChanged(slider, value) {
    this.setColor(this.current.withAlpha(value));
  }

  /** Something was typed in the hex field; what isn't a colour is ignored. */
  hexChanged(field, value) {
    const color = Color.fromHex(value, this.current.alpha);
    if (color) this.setColor(color);
  }

  /** Enter in the hex field is the user saying they are done. */
  hexEntered(field, value) {
    this.hexChanged(field, value);
    this.firePicked();
  }

  // --- painting ------------------------------------------------------------

  /** Painted once it is on screen: a canvas with no layout has no size. */
  attached() {
    this.paint();
  }

  /**
   * Paint both pickers.
   *
   * A canvas holds its size twice — the box the page gives it, and the grid of
   * pixels it draws on — so the second is set from the first before anything
   * is drawn on it, or the paint comes out stretched.
   */
  paint() {
    this.paintSquare();
    this.paintStrip();
  }

  /** The canvas's own pixel grid, sized to the box the page gave it. */
  contextFor(canvas) {
    if (!canvas) return null;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas.getContext?.("2d") ?? null;
  }

  /** White to the hue across, clear to black down, and the mark on top. */
  paintSquare() {
    const canvas = this.svCanvas;
    const context = this.contextFor(canvas);
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;

    const across = context.createLinearGradient(0, 0, width, 0);
    across.addColorStop(0, "#FFFFFF");
    across.addColorStop(1, Color.fromHSB(this.hue, 1, 1).toHexString());
    context.fillStyle = across;
    context.fillRect(0, 0, width, height);

    const down = context.createLinearGradient(0, 0, 0, height);
    down.addColorStop(0, "rgba(0,0,0,0)");
    down.addColorStop(1, "rgba(0,0,0,1)");
    context.fillStyle = down;
    context.fillRect(0, 0, width, height);

    // Two rings rather than one, so the mark reads on a light colour and on
    // a dark one alike.
    const x = this.saturation * (width - 1);
    const y = (1 - this.brightness) * (height - 1);
    context.lineWidth = 1.5;
    context.strokeStyle = "#FFFFFF";
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "rgba(0,0,0,0.85)";
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.stroke();
  }

  /** The spectrum down the strip, with a bar at the hue being worked. */
  paintStrip() {
    const canvas = this.hueCanvas;
    const context = this.contextFor(canvas);
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;

    const spectrum = context.createLinearGradient(0, 0, 0, height);
    for (let stop = 0; stop <= 6; stop++) {
      spectrum.addColorStop(
        stop / 6,
        Color.fromHSB(stop / 6, 1, 1).toHexString(),
      );
    }
    context.fillStyle = spectrum;
    context.fillRect(0, 0, width, height);

    const barHeight = 4;
    const y = Math.max(
      0,
      Math.min(
        height - barHeight,
        Math.round(this.hue * height) - barHeight / 2,
      ),
    );
    context.lineWidth = 1;
    context.strokeStyle = "#FFFFFF";
    context.strokeRect(0.5, y + 0.5, width - 1, barHeight - 1);
    context.strokeStyle = "rgba(0,0,0,0.8)";
    context.strokeRect(1.5, y + 1.5, width - 3, barHeight - 3);
  }

  // --- drawing -------------------------------------------------------------

  drawPalette() {
    return (
      <div
        styleName="ccp-palette"
        style={{ gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, 1fr)` }}
      >
        {PALETTE.map((rgb) => (
          <div
            key={rgb}
            styleName="ccp-swatch"
            style={{ backgroundColor: Color.fromRGB(rgb).toHexString() }}
            title={Color.fromRGB(rgb).toHexString()}
            onpointerdown={() => this.pickSwatch(rgb)}
          />
        ))}
      </div>
    );
  }

  draw() {
    this.awake();
    const color = this.current;

    return (
      <div styleName="ccp-root" role="group" aria-label={this.message("Colour chooser")}>
        {this.drawPalette()}

        <div styleName="ccp-custom">
          <div styleName="ccp-pickers">
            <canvas
              styleName="ccp-sv"
              ref={(el) => (this.svCanvas = el)}
              aria-label={this.message("Saturation and brightness")}
            />
            <canvas
              styleName="ccp-hue"
              ref={(el) => (this.hueCanvas = el)}
              aria-label={this.message("Hue")}
            />
          </div>

          <div styleName="ccp-alpha-row">
            <span>Opacity</span>
            <Slider
              minValue="0"
              maxValue="100"
              value={color.alpha}
              action="alphaChanged"
            />
            <span styleName="ccp-alpha-value">{`${color.alpha}%`}</span>
          </div>

          <div styleName="ccp-footer">
            <div styleName="ccp-preview">
              <div
                styleName="ccp-preview-color"
                style={{ backgroundColor: color.toString() }}
              />
            </div>
            <span styleName="ccp-hash">#</span>
            <TextField
              value={color.toHexString().slice(1)}
              action="hexEntered change:hexChanged"
            />
          </div>
        </div>
      </div>
    );
  }
}
