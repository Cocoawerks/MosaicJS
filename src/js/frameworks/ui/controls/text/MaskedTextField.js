// MaskedTextField: a field that holds a shape, and lets the user fill only the
// places the shape leaves open. It draws no markup of its own — the box, the
// input and the two icon slots are TextBase's:
//   <MaskedTextField mask="(999) 999-9999" outlet="phone" action="dialled"/>
// The mask is read once into two lists that run beside each other, one entry
// per position: `tests`, the pattern a position accepts or null where the mask
// states a literal, and `buffer`, what is shown there now. Every move the
// control makes — typing, deleting, leaving — is a change to those lists,
// written back to the input in one go. The caret is then put where the user
// would expect it, which is the part a mask gets wrong most easily.
import TextBase from "./TextBase.js";

/**
 * What each mask character accepts, as MaskedTextField.DEFINITIONS does.
 * Anything else in a mask is a literal the user never types over.
 *
 *   9   a digit
 *   a   a letter
 *   *   either
 *
 * A `?` is not here: it marks where the rest of the mask becomes optional, so
 * `99999?-9999` is a zip code that may or may not carry its +4.
 */
const DEFINITIONS = {
  9: /[0-9]/,
  a: /[A-Za-z]/,
  "*": /[A-Za-z0-9]/,
};

/**
 * How long after focus the caret is placed, matching the Java Timer.
 *
 * Focus arrives before the browser has settled its own caret, so placing it in
 * the same turn is placing it before something that will overwrite it.
 */
const CARET_DELAY = 10;

export default class MaskedTextField extends TextBase {
  static properties = {
    /** Whether the text can be read but not changed. */
    readOnly: { type: Boolean, default: false },
    /** Off by default, as the Java version sets it. */
    /** Off by default. */
    spellCheck: { type: Boolean, default: false },
  };

  constructor(props) {
    super(props);

    /** A pattern per position, null where the mask states a literal. */
    this.tests = null;
    /** What each position shows: a typed character, or its placeholder. */
    this.buffer = null;
    /** The buffer as it is with nothing filled in, to recognise an empty field. */
    this.defaultBuffer = "";
    /** What the field held when it was entered, for Escape to put back. */
    this.focusText = "";
    /** The mask `tests` and `buffer` were built from. */
    this.parsedMask = null;
    this.caretTimer = null;

    /** Positions the mask covers; a `?` shortens this. */
    this.len = 0;
    /** Where the mask stops being required. */
    this.partialPosition = 0;
    /** The first position the user can type in. */
    this.firstNonMaskPos = -1;
  }

  // --- configuration -------------------------------------------------------

  /** The shape the field holds, as `setMask()` states it. */
  get mask() {
    return this.get("mask", "");
  }

  set mask(value) {
    this.set("mask", value ?? "");
    this.parseMask();
  }

  /**
   * What an unfilled position shows. A string of one character fills every
   * position with it; a longer one is read position by position, so a date can
   * read `dd/mm/yyyy` before it is typed into.
   */
  get maskPlaceholder() {
    return this.get("maskPlaceholder", "_");
  }

  set maskPlaceholder(value) {
    this.set("maskPlaceholder", value || "_");
    this.parseMask();
  }

  // --- what the field is worth ---------------------------------------------

  /**
   * What the user typed, without the mask around it: `(216) 555-0134` is
   * `2165550134`. The literals are dropped, and so is every position still
   * showing its placeholder.
   *
   * @returns {string} The filled positions, in order.
   */
  get valueWithoutMask() {
    const value = this.value;
    if (!value || !this.tests) return "";

    let out = "";
    for (let i = 0; i < value.length && i < this.tests.length; i++) {
      if (!this.tests[i]) continue;
      const ch = value.charAt(i);
      if (ch !== this.placeholderCharAt(i)) out += ch;
    }
    return out;
  }

  /**
   * A masked field is blank when nothing has been typed into it — the mask's
   * own literals do not count as content, which is what `isBlank()` overrides.
   */
  get blank() {
    return this.valueWithoutMask.trim() === "";
  }

  // --- the mask ------------------------------------------------------------

  /**
   * Read the mask into `tests` and `buffer`.
   *
   * Called whenever the mask might have changed rather than once at attach:
   * the mask can arrive as a prop, which is never assigned through the setter.
   */
  parseMask() {
    const mask = this.mask;
    if (this.parsedMask === mask && this.tests) return;
    this.parsedMask = mask;

    if (!mask) {
      this.tests = null;
      this.buffer = null;
      return;
    }

    this.len = mask.length;
    this.partialPosition = this.len;
    this.firstNonMaskPos = -1;
    this.tests = [];
    this.buffer = [];

    for (let i = 0; i < mask.length; i++) {
      const c = mask.charAt(i);
      if (c === "?") {
        // The `?` is not a position of its own: it says the rest may be left
        // empty, and the field is one character shorter than the mask reads.
        this.len--;
        this.partialPosition = i;
      } else if (Object.prototype.hasOwnProperty.call(DEFINITIONS, c)) {
        this.tests.push(DEFINITIONS[c]);
        if (this.firstNonMaskPos === -1)
          this.firstNonMaskPos = this.tests.length - 1;
        this.buffer.push(this.placeholderCharAt(this.buffer.length));
      } else {
        this.tests.push(null);
        this.buffer.push(c);
      }
    }

    this.defaultBuffer = this.bufferString();
    this.focusText = this.value;
  }

  /** Whether there is a mask to enforce and it has been read. */
  maskReady() {
    this.parseMask();
    return !!(this.mask && this.tests && this.buffer && this.buffer.length > 0);
  }

  /** What position `pos` shows while it is unfilled. */
  placeholderCharAt(pos) {
    const placeholder = this.maskPlaceholder;
    return pos < placeholder.length
      ? placeholder.charAt(pos)
      : placeholder.charAt(0);
  }

  /** The next position the user can type in, at or after `pos`. */
  seekNext(pos) {
    while (
      ++pos < this.len &&
      (pos >= this.tests.length || this.tests[pos] === null)
    );
    return pos;
  }

  /** The last such position before `pos`. */
  seekPrev(pos) {
    while (
      --pos >= 0 &&
      (pos >= this.tests.length || this.tests[pos] === null)
    );
    return pos;
  }

  /** Where the user has got to: the first position still showing a placeholder. */
  firstUnfilled() {
    for (let i = 0; i < this.len && i < this.buffer.length; i++) {
      if (this.tests[i] && this.buffer[i] === this.placeholderCharAt(i))
        return i;
    }
    return this.len;
  }

  // --- the input's caret ----------------------------------------------------
  //
  // Guarded throughout: an input reports its selection only while it is in a
  // document and has focus, and a field being driven by a test may be neither.

  /** Whether the input is the focused element. */
  hasFocus() {
    return (
      !!this.inputLayer &&
      this.inputLayer === this.inputLayer.ownerDocument?.activeElement
    );
  }

  selection() {
    const el = this.inputLayer;
    return { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
  }

  setSelection(start, end) {
    this.inputLayer?.setSelectionRange?.(start, end);
  }

  /**
   * Move the caret, or read where it is. `caret(-1, -1)` reads; anything else
   * writes, and `end` of -1 means a caret rather than a selection.
   *
   * @returns {number[]} Where the caret ended up, as [start, end].
   */
  caret(begin, end) {
    const value = this.inputLayer?.value;
    if (!value || !this.hasFocus()) return [0, 0];

    if (begin > -1) {
      const to = end > -1 ? end : begin;
      this.setSelection(begin, to);
      return [begin, to];
    }

    const { start, end: stop } = this.selection();
    return [start, stop];
  }

  /**
   * Keep the caret within what has been filled in, so a click past the end of
   * a half-typed field lands where typing would continue rather than in the
   * middle of the placeholders.
   *
   * Deferred: the click has not moved the caret yet when this runs.
   */
  clampCursor() {
    if (!this.enabled || !this.maskReady()) return;

    queueMicrotask(() => {
      if (!this.hasFocus()) return;
      const max = this.firstUnfilled();
      const { start, end } = this.selection();
      if (start > max) this.caret(max, -1);
      else if (end > max) this.caret(start, max);
    });
  }

  // --- the buffer -----------------------------------------------------------

  bufferString() {
    return this.buffer.join("");
  }

  writeBuffer() {
    if (this.inputLayer) this.inputLayer.value = this.bufferString();
  }

  /** Empty the typed positions in [start, end). Literals are left alone. */
  clearBuffer(start, end) {
    for (
      let i = start;
      i < end && i < this.len && i < this.buffer.length;
      i++
    ) {
      if (i >= 0 && this.tests[i]) this.buffer[i] = this.placeholderCharAt(i);
    }
  }

  /**
   * Close a gap: everything after `end` slides back over it, so deleting a
   * digit from the middle pulls the rest along rather than leaving a hole.
   */
  shiftLeft(begin, end) {
    if (begin < 0) return;

    for (
      let i = begin, j = this.seekNext(end);
      i < this.len && i < this.buffer.length;
      i++
    ) {
      if (!this.tests[i]) continue;
      if (
        j < this.len &&
        j < this.buffer.length &&
        this.tests[i].test(this.buffer[j])
      ) {
        this.buffer[i] = this.buffer[j];
        this.buffer[j] = this.placeholderCharAt(j);
      } else {
        break;
      }
      j = this.seekNext(j);
    }

    this.writeBuffer();
    this.caret(Math.max(0, Math.max(this.firstNonMaskPos, begin)), -1);
  }

  /**
   * Read what the input holds back into the buffer, keeping only what the mask
   * accepts, and say where the caret belongs afterwards.
   *
   * @param {boolean} allow Whether a partly filled field may stay as it is —
   *     true while typing, false on leaving, when a field that never got past
   *     its optional point is emptied instead of left half-written.
   * @param {number} [caretHint] Where the user was typing, so the caret can
   *     stay there instead of jumping to the end.
   * @returns {number} Where to put the caret.
   */
  checkVal(allow, caretHint = -1) {
    const test = this.inputLayer?.value ?? "";
    let lastMatch = -1;
    let nextCaretPos = Math.max(0, this.firstNonMaskPos);
    let pos = 0;

    for (let i = 0; i < this.len && i < this.buffer.length; i++) {
      if (this.tests[i]) {
        this.buffer[i] = this.placeholderCharAt(i);
        while (pos < test.length) {
          const c = test.charAt(pos);
          pos++;
          if (this.tests[i].test(c)) {
            this.buffer[i] = c;
            lastMatch = i;
            nextCaretPos = this.seekNext(i);
            break;
          }
        }
      } else {
        // A literal the user typed over is consumed, so the rest still lines up.
        if (pos < test.length && this.buffer[i] === test.charAt(pos)) pos++;
        if (i < this.partialPosition) lastMatch = i;
      }
    }

    if (allow) {
      this.writeBuffer();
    } else if (lastMatch + 1 < this.partialPosition) {
      // Nothing required was filled in. An untouched field is emptied rather
      // than left showing a row of placeholders.
      if (this.bufferString() === this.defaultBuffer) {
        if (this.inputLayer) this.inputLayer.value = "";
        this.clearBuffer(0, this.len);
      } else {
        this.writeBuffer();
      }
    } else {
      this.writeBuffer();
      const current = this.inputLayer?.value;
      if (
        current != null &&
        lastMatch >= 0 &&
        lastMatch + 1 <= current.length
      ) {
        this.inputLayer.value = current.substring(0, lastMatch + 1);
      }
    }

    if (caretHint >= 0 && caretHint <= this.len) {
      let hint = caretHint;
      // A hint that lands on a literal moves on to the next place that takes
      // typing: the caret must never sit where nothing can be typed.
      if (
        hint < this.len &&
        hint < this.tests.length &&
        this.tests[hint] === null
      ) {
        hint = this.seekNext(hint - 1);
      }
      return Math.min(hint, this.len);
    }

    return Math.min(nextCaretPos, this.len);
  }

  // --- behaviour -------------------------------------------------------------
  // Each method is named after the DOM event it handles, so the base class
  // binds it; `focus` and `blur` are the input's, bound by TextBase.

  /** The mask is read as soon as the field is on screen, as `onAttach()` does. */
  attached() {
    super.attached?.();
    this.parseMask();
  }

  input() {
    if (!this.enabled) return;

    if (this.maskReady()) {
      // Taken before the buffer is rewritten: afterwards the caret is wherever
      // assigning to `value` left it, which is the end.
      const caretPos = this.selection().start;
      const nextPos = this.checkVal(true, caretPos);
      this.setSelection(nextPos, nextPos);
    }

    if (this.continuous) this.reportLater();
  }

  focus() {
    super.focus();
    if (!this.enabled || !this.maskReady()) return;

    if (this.caretTimer !== null) clearTimeout(this.caretTimer);

    this.focusText = this.value;
    this.checkVal(false);
    this.writeBuffer();

    const pos = this.firstUnfilled();
    this.caretTimer = setTimeout(() => {
      this.caretTimer = null;
      // The field may have been left again in the meantime.
      if (!this.hasFocus()) return;
      this.caret(pos, -1);
    }, CARET_DELAY);
  }

  blur() {
    super.blur();
    if (!this.enabled || !this.maskReady()) return;
    this.checkVal(false);
  }

  keyDown(event) {
    if (!this.maskReady()) return;
    if (event.key === "Tab" || this.readOnly) return;

    switch (event.key) {
      case "Backspace":
      case "Delete": {
        event.preventDefault?.();
        const isDelete = event.key === "Delete";
        let [begin, end] = this.caret(-1, -1);

        // Nothing is selected, so the key decides what one character means:
        // Backspace takes the one before the caret, Delete the one after.
        if (end - begin === 0) {
          if (isDelete) {
            end = this.seekNext(begin - 1);
            begin = end;
            end = this.seekNext(end);
          } else {
            begin = this.seekPrev(begin);
          }
        }

        this.clearBuffer(begin, end);
        this.shiftLeft(begin, end - 1);

        if (this.continuous) this.reportLater();
        break;
      }

      case "Enter":
        this.inputLayer?.blur?.();
        break;

      case "Escape":
        event.preventDefault?.();
        if (this.inputLayer) this.inputLayer.value = this.focusText;
        this.caret(0, this.checkVal(false));
        break;
    }
  }

  /** A click can land anywhere; the caret is pulled back to what is filled in. */
  mouseUp() {
    this.clampCursor();
  }

  /**
   * Report the new value once the event that changed it has been dealt with,
   * as `Scheduler.scheduleDeferred` does: the input has not finished with the
   * keystroke yet, and the value read now would be the one before it.
   */
  reportLater() {
    queueMicrotask(() => this.fireChange(this.value));
  }

  /** A field taken apart mid-edit must not leave its caret timer behind. */
  destroy() {
    if (this.caretTimer !== null) {
      clearTimeout(this.caretTimer);
      this.caretTimer = null;
    }
    super.destroy();
  }

  inputExtras() {
    return {
      readonly: this.readOnly ? "readonly" : null,
      spellcheck: String(this.spellCheck),
    };
  }
}
