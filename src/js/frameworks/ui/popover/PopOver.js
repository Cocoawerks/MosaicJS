// PopOver, ported from GWT Mosaic (client/components/PopOver.java and the
// PopOverPanel it wraps, with resources/popover/PopOverPanel.ui.xml): a floating
// panel that hangs off something on the page, with a callout pointing back at
// what it belongs to.
//
// The Java version is two classes — PopOver, which is the thing an application
// holds, and PopOverPanel, which is the element it draws and positions. There is
// one here: a Mosaic component already *is* what it draws, so the panel's job is
// `draw()` and its measuring is the component's own.
//
// Whatever it should hold is its children, so a popover of an application's own
// is a `.mib` file whose root is this component:
//
//   <!-- ColourPopOver.mib -->
//   <PopOver orientation="bottom_center">
//       <h3>Pick a colour</h3>
//       <Button text="Red" action="pick"/>
//   </PopOver>
//
// with the behaviour beside it in ColourPopOverController.js, which the
// compiler pairs with it by name. The page then names the popover as a tag and
// keeps an outlet on it:
//
//   <ColourPopOver outlet="colours"/>
//   <Button text="Colour…" outlet="colourButton" action="showColours"/>
//
//   showColours(button) { this.colours.show(button); }
import { Component } from "mosaic";

import "./popover.css";

/**
 * Where a popover sits against what it hangs from, and which of its edges lines
 * up with that thing's — `PopOverOrientation.java`, whose names these are.
 *
 * The first word is the side it sits on; the second is the edge that lines up.
 */
export const PopOverOrientation = Object.freeze({
  TOP_LEFT: "top_left",
  TOP_CENTER: "top_center",
  TOP_RIGHT: "top_right",
  BOTTOM_LEFT: "bottom_left",
  BOTTOM_CENTER: "bottom_center",
  BOTTOM_RIGHT: "bottom_right",
  LEFT_TOP: "left_top",
  LEFT_MIDDLE: "left_middle",
  LEFT_BOTTOM: "left_bottom",
  RIGHT_TOP: "right_top",
  RIGHT_MIDDLE: "right_middle",
  RIGHT_BOTTOM: "right_bottom",
});

/** The gap between a popover and what it hangs from, callout included. */
const ANCHOR_GAP = 9;

/** The side a popover falls back to when the one it was told to use has no room. */
const OPPOSITE = Object.freeze({
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
});

/**
 * How near a corner the callout may sit, and how far along its side it may go.
 * A callout asked for a place outside that is a callout pointing at nothing —
 * see {@link PopOver#pointCallout}.
 */
const CALLOUT_EDGE = 8;
const CALLOUT_END = 14;

/** How close to the window's edge a popover may be pushed. */
const EDGE_MARGIN = 7;

/** What can take the keyboard, for a popover opened from it. */
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled])," +
  " select:not([disabled]), textarea:not([disabled])," +
  ' [tabindex]:not([tabindex="-1"])';

/**
 * Every popover on screen that dismisses itself, so they can all be put away at
 * once — what `PopOver.visibleTransients` is for in Java.
 *
 * @type {Set<PopOver>}
 */
const openTransients = new Set();

/** Put away every popover that dismisses itself. */
export function closeTransientPopOvers() {
  for (const popOver of [...openTransients]) popOver.hide();
}

export default class PopOver extends Component {
  /**
   * The class this component draws its root with — what a stylesheet is
   * naming when it says `PopOver`. See Component.styleName.
   */
  static styleName = "v-PopOver";

  static props = {
    /** One of PopOverOrientation. */
    orientation: { type: String, default: PopOverOrientation.BOTTOM_CENTER },
    /** Whether the callout triangle is drawn. `setHasCallout` in Java. */
    callout: { type: Boolean, default: true },
    /**
     * Whether it puts itself away — on a press outside it, on Escape, and
     * when the window is resized or scrolled. A popover that stays until it
     * is told otherwise sets this false.
     */
    transient: { type: Boolean, default: true },
  };

  constructor() {
    super();

    /** Whether it is on screen. */
    this.open = false;

    /** What it was last shown against, so it can be put back there. */
    this.anchorElement = null;

    /**
     * The side it was actually placed on, which is the stated one unless
     * that would have taken it off the window. Null until it is placed.
     *
     * @type {string|null}
     */
    this.placedPosition = null;

    /**
     * Whether the callout can be aimed at what the popover hangs from. It
     * cannot when the popover had to be pushed clear of the window's edge
     * and ended up beside its anchor rather than against it.
     */
    this.calloutFits = true;

    /** Elements a press on which does not count as a press outside. */
    this.closeExceptions = new Set();

    // Bound once so they can be taken off again: `addEventListener` removes
    // by identity, and a fresh arrow function each time removes nothing.
    this.onWindowChange = () => this.hide();
    this.onPointerDownOutside = (event) => {
      if (this.isPressOutside(event)) this.hide();
    };
    this.onEscape = (event) => {
      if (event.key !== "Escape") return;
      // An open popover owns Escape: it goes no further, so no dialog
      // above it and nothing else on the page also acts on the key.
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    };
  }

  /**
   * Which side it should sit on, and which edge lines up — one of
   * PopOverOrientation.
   *
   * Written by hand rather than left to `static props` because a side it was
   * pushed off is no longer the side it was told to use: what it settled on
   * last time is forgotten here, and worked out again the next time it is
   * shown.
   */
  get orientation() {
    return this.get("orientation", PopOverOrientation.BOTTOM_CENTER);
  }

  set orientation(value) {
    this.set("orientation", value ?? PopOverOrientation.BOTTOM_CENTER);
    this.placedPosition = null;
  }

  // --- showing and hiding --------------------------------------------------

  /**
   * Show it lined up with something — an element, or a component that drew
   * one. `show(alignWithWidget)` in Java, whose name this keeps: what the
   * popover is aligned with is what the caller is saying.
   *
   * @param {Element|object} alignWith What it should hang from.
   * @param {number} offsetLeft Nudged this far across, once placed.
   * @param {number} offsetTop And this far down.
   */
  alignWith(alignWith, offsetLeft = 0, offsetTop = 0) {
    const element = elementOf(alignWith);
    if (!element) return;

    this.anchorElement = element;
    this.offset = { left: offsetLeft, top: offsetTop };
    this.setOpen(true);
    this.place();
  }

  /** The same, under the name the rest of the framework shows things by. */
  show(alignWith, offsetLeft = 0, offsetTop = 0) {
    this.alignWith(alignWith, offsetLeft, offsetTop);
  }

  /**
   * Show it at a point in the window, hanging from nothing — `showAt` in Java.
   * A context menu is the case for it.
   */
  showAt(left, top) {
    this.anchorElement = null;
    // Nothing to fit against, so the side it was told to use is the side.
    this.placedPosition = null;
    this.setOpen(true);
    this.placeAt(left, top);
  }

  /** Put it away. */
  hide() {
    if (!this.open) return;
    this.setOpen(false);
  }

  /** Show it if it is away, put it away if it is up. */
  toggle(anchor) {
    if (this.open) this.hide();
    else this.show(anchor);
  }

  get visible() {
    return this.open;
  }

  set visible(value) {
    if (this.bool(value)) this.show(this.anchorElement);
    else this.hide();
  }

  /**
   * Open or shut, and everything that follows from it: the listeners a
   * transient popover needs while it is up, the registry of what is on
   * screen, and the action, which is what an application hears.
   */
  setOpen(open) {
    if (this.open === open) return;
    this.open = open;
    this.needsDisplay();

    if (open) {
      this.listenWhileOpen();
      if (this.transient) openTransients.add(this.self);
    } else {
      this.stopListening();
      openTransients.delete(this.self);
      // A control inside a popover that is going away must not keep the
      // keyboard; `inert` takes the whole subtree out of the tab order.
      this.node?.blur?.();
    }

    this.reportOpen(open);
  }

  /**
   * Say that it opened, or that it closed. A kind of popover whose action
   * means something else — a menu's is the item that was chosen — says so
   * here instead, and keeps `onOpen` and `onClose`, which never mean anything
   * but what they say.
   */
  reportOpen(open) {
    this.props.action?.(this.self, open);
    (open ? this.props.onOpen : this.props.onClose)?.(this.self);
  }

  /**
   * Put the keyboard on the first thing inside that can take it, so a popover
   * opened from the keyboard can be used from it. Call after `show`: a hidden
   * element takes no focus.
   */
  focusFirstControl() {
    this.node?.querySelector(FOCUSABLE)?.focus?.({ preventScroll: true });
  }

  // --- what it listens to while it is up -----------------------------------

  listenWhileOpen() {
    // Escape is caught on the way down, before anything focused can act on
    // it, which is what `Event.addNativePreviewHandler` gives the Java
    // version. A press outside is caught the same way, so a control that
    // stops the event on its own does not keep the popover open.
    document.addEventListener("keydown", this.onEscape, true);
    if (!this.transient) return;

    document.addEventListener("pointerdown", this.onPointerDownOutside, true);
    window.addEventListener("resize", this.onWindowChange);
    window.addEventListener("scroll", this.onWindowChange, true);
  }

  stopListening() {
    document.removeEventListener("keydown", this.onEscape, true);
    document.removeEventListener(
      "pointerdown",
      this.onPointerDownOutside,
      true,
    );
    window.removeEventListener("resize", this.onWindowChange);
    window.removeEventListener("scroll", this.onWindowChange, true);
  }

  /** Its listeners go when it does, wherever it was in the middle of. */
  detached() {
    this.stopListening();
    openTransients.delete(this.self);
  }

  /**
   * A press outside is one that landed neither in the popover nor on anything
   * excused — the button it hangs from, above all, so a press there does not
   * put it away only for the click to open it again.
   */
  isPressOutside(event) {
    const target = event.target;
    if (this.node?.contains?.(target)) return false;
    if (this.anchorElement?.contains?.(target)) return false;
    for (const element of this.closeExceptions) {
      if (element?.contains?.(target)) return false;
    }
    return true;
  }

  /** A press on `what` does not put this popover away. */
  addCloseException(what) {
    const element = elementOf(what);
    if (element) this.closeExceptions.add(element);
  }

  removeCloseException(what) {
    this.closeExceptions.delete(elementOf(what));
  }

  // --- where it goes -------------------------------------------------------

  /** The side it sits on: "top", "bottom", "left" or "right". */
  get position() {
    return String(this.orientation).split("_")[0];
  }

  /** The edge that lines up: "left", "center", "right", "top", "middle", "bottom". */
  get edge() {
    return String(this.orientation).split("_")[1];
  }

  /**
   * The side it is drawn on: the one it was placed on, or the one it was told
   * to use until it has been placed.
   */
  get shownPosition() {
    return this.placedPosition ?? this.position;
  }

  /**
   * Put it where its orientation says, against what it is lined up with.
   *
   * If the side it was told to use has no room for it, the opposite one is
   * tried — a popover told to sit below something near the foot of the window
   * sits above it instead, and its callout turns to match. It stays where it
   * was told when neither side fits, since a choice between two bad ones is
   * better made by what asked for it.
   */
  place() {
    const node = this.node;
    if (!node || !this.anchorElement) return;

    // Measured now rather than a frame later: a popover is hidden with
    // `visibility`, which still lays the element out, and reading its size
    // is what settles the layout to read. The Java version defers because
    // it has just switched the panel on; nothing here has to wait.
    const frame = this.anchorElement.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;

    let side = this.position;
    let at = this.placeOn(side, frame, width, height);

    if (!fits(side, at, width, height)) {
      const other = OPPOSITE[side];
      const there = this.placeOn(other, frame, width, height);
      if (other && fits(other, there, width, height)) {
        side = other;
        at = there;
      }
    }

    // The callout points out of whichever side it ended up on, so a flip
    // has to be drawn before it is pointed.
    if (this.placedPosition !== side) {
      this.placedPosition = side;
      this.needsDisplay();
    }

    const placed = this.keepInWindow(at.left, at.top, width, height);
    this.writePosition(placed.left, placed.top);
    this.pointCallout(placed, frame);
  }

  /**
   * Where it would sit on `side`: that side settles one axis, and the
   * orientation's edge lines up the other.
   */
  placeOn(side, frame, width, height) {
    let left = 0;
    let top = 0;

    switch (side) {
      case "bottom":
        top = frame.top + frame.height + ANCHOR_GAP;
        break;
      case "top":
        top = frame.top - height - ANCHOR_GAP;
        break;
      case "right":
        left = frame.left + frame.width + ANCHOR_GAP;
        break;
      case "left":
        left = frame.left - width - ANCHOR_GAP;
        break;
      default:
    }

    switch (this.edge) {
      case "center":
        left = frame.left - (width - frame.width) / 2;
        break;
      case "left":
        left = frame.left;
        break;
      case "right":
        left = frame.left + frame.width - width;
        break;
      case "middle":
        top = frame.top - (height - frame.height) / 2;
        break;
      case "top":
        top = frame.top;
        break;
      case "bottom":
        top = frame.top + frame.height - height;
        break;
      default:
    }

    return {
      left: left + (this.offset?.left ?? 0),
      top: top + (this.offset?.top ?? 0),
    };
  }

  /** Put it at a point in the window, nudged clear of it by its orientation. */
  placeAt(left, top) {
    const node = this.node;
    if (!node) return;

    switch (this.position) {
      case "bottom":
        top += 2;
        break;
      case "top":
        top -= node.offsetHeight + 2;
        break;
      case "right":
        left += 2;
        break;
      case "left":
        left -= node.offsetWidth + 2;
        break;
      default:
    }
    this.writePosition(left, top);
  }

  /**
   * The same box, moved back inside the window if it hung over an edge — what
   * `adjustPosition` does in Java.
   */
  keepInWindow(left, top, width, height) {
    const right = window.innerWidth - left - width;
    if (right < 0) left += right - 6;
    if (left < 0) left = EDGE_MARGIN;

    const bottom = window.innerHeight - top - height;
    if (bottom < 0) top += bottom - EDGE_MARGIN;
    if (top < 0) top = EDGE_MARGIN;

    return { left, top, width, height };
  }

  /**
   * Written to the element rather than drawn: a position is measured from the
   * document and settled after layout, and drawing it would mean a redraw per
   * frame of a drag or a scroll.
   *
   * A popover is `position: fixed`, so what it is written in is the window's
   * own frame — unless an ancestor establishes a containing block for fixed
   * children, which a transform or an open `<dialog>` does. Where zero lands
   * is measured and taken off, so the same numbers work either way.
   */
  writePosition(left, top) {
    const node = this.node;
    node.style.left = "0px";
    node.style.top = "0px";
    const origin = node.getBoundingClientRect();
    node.style.left = `${left - origin.left}px`;
    node.style.top = `${top - origin.top}px`;
  }

  /**
   * Point the callout at the middle of what the popover hangs from, wherever
   * the popover itself had to be moved to.
   *
   * A popover pushed back inside the window can end up somewhere its callout
   * cannot point from. There are two ways of that, and both leave the callout
   * out — a popover with no callout is a plain panel, which says less than a
   * callout aimed at the wrong thing:
   *
   *   - beside what it hangs from rather than against it, so no place along
   *     its edge points at the anchor;
   *   - over what it hangs from, when the window has room for it on neither
   *     side, so the callout would point into the popover itself.
   */
  pointCallout(box, frame) {
    const callout = this.calloutNode;
    if (!callout || !this.callout) return;

    callout.removeAttribute("style");
    const sideways =
      this.shownPosition === "top" || this.shownPosition === "bottom";

    let at;
    let end;
    if (sideways) {
      const dx = Math.max(0, frame.left) - box.left;
      end = box.width - CALLOUT_END;
      at = dx + frame.width / 2;
      if (this.edge === "left") at = CALLOUT_END + dx;
      else if (this.edge === "right") at = dx + frame.width - 28;
    } else {
      end = box.height - CALLOUT_END;
      at = frame.top + frame.height / 2 - box.top;
    }

    this.showCallout(
      this.clearOfAnchor(box, frame) && at >= CALLOUT_EDGE && at <= end,
    );
    if (!this.calloutFits) return;

    if (sideways) {
      callout.style.left = `${at}px`;
    } else {
      callout.style.top = `${at}px`;
      callout.style.marginTop = "-6px";
    }
  }

  /**
   * Whether the popover ended up on the side it claims, clear of what it
   * hangs from. A window with room on neither side leaves it over the anchor,
   * and a callout has nothing to span.
   */
  clearOfAnchor(box, frame) {
    switch (this.shownPosition) {
      case "bottom":
        return box.top >= frame.bottom;
      case "top":
        return box.top + box.height <= frame.top;
      case "right":
        return box.left >= frame.right;
      case "left":
        return box.left + box.width <= frame.left;
      default:
        return true;
    }
  }

  /**
   * Whether the callout is drawn at all this time round. Drawn rather than
   * hidden by hand, because what the callout wears is `draw`'s to say — and a
   * change of mind has to be drawn before the callout can be placed.
   */
  showCallout(fits) {
    if (this.calloutFits === fits) return;
    this.calloutFits = fits;
    this.needsDisplay();
  }

  // --- drawing -------------------------------------------------------------

  /** Whether a callout is wanted and can be aimed at what it belongs to. */
  get hasCallout() {
    return this.callout && this.calloutFits !== false;
  }

  /**
   * Classes the panel wears besides `v-PopOver`. A kind of popover that has a
   * face of its own — a menu, a tooltip — names it here, and the theme has
   * something to style.
   */
  panelClasses() {
    return [];
  }

  /** The classes the callout wears, which say where it points from. */
  calloutClasses() {
    if (!this.hasCallout) return ["PopOver-callout", "PopOver-callout-none"];
    return [
      "PopOver-callout",
      `PopOver-callout--${this.shownPosition[0]}`,
      `PopOver-callout--${this.edge}`,
    ];
  }

  triangleClasses() {
    if (!this.hasCallout) return ["PopOver-triangle", "PopOver-triangle-none"];
    return ["PopOver-triangle", `PopOver-triangle--${this.shownPosition[0]}`];
  }

  /**
   * What a reader is being shown. A popover is a dialogue by default; a kind
   * of popover that is something else — a menu — says so here, as
   * `Roles.getMenuRole().set(...)` does for the Java version.
   */
  panelRole() {
    return "dialog";
  }

  /**
   * What the popover holds: whatever the markup put in it. A popover of a
   * kind that holds one particular thing — a tooltip's words, a menu's items
   * — says so here instead.
   */
  drawContent() {
    return this.props.children;
  }

  draw() {
    return (
      <div
        styleName={[
          "v-PopOver",
          ...this.panelClasses(),
          this.open ? "is-open" : null,
        ]}
        role={this.panelRole()}
        tabindex="0"
        aria-hidden={this.open ? null : "true"}
        inert={this.open ? null : ""}
      >
        <b
          styleName={this.calloutClasses()}
          ref={(el) => (this.calloutNode = el)}
        >
          <b styleName={this.triangleClasses()} />
        </b>
        {this.drawContent()}
      </div>
    );
  }
}

/**
 * Whether a box placed on `side` is wholly within the window on that side. Only
 * the side's own axis is asked about: the other one is what `keepInWindow`
 * nudges, and nudging along it changes nothing about which side to use.
 */
function fits(side, at, width, height) {
  switch (side) {
    case "bottom":
      return at.top + height <= window.innerHeight;
    case "top":
      return at.top >= 0;
    case "right":
      return at.left + width <= window.innerWidth;
    case "left":
      return at.left >= 0;
    default:
      return true;
  }
}

/** An element, whether given one or a component that drew one. */
function elementOf(what) {
  if (!what) return null;
  if (what.nodeType === 1) return what;
  return what.node ?? null;
}
