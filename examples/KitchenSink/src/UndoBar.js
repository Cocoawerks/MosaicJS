// A snackbar of the application's own: what the page shows when something was
// deleted, with the button that takes it back.
//
// A component rather than a `.mib` file, which is how the framework builds its
// own bars (Toast is exactly this): a bar's content is drawn by the bar, so a
// kind of bar says what it holds by overriding `drawContent`. A `.mib` would
// give the markup a controller of its own, which a bar has no use for — what it
// has to say goes back to whoever showed it.
import {Button, SnackBar} from "mosaic/frameworks/ui";

import "./undo-bar.css";

export default class UndoBar extends SnackBar {
  static props = {
    /** What it says happened. */
    text: { type: String, default: "" },
    /** It asks a question, so it waits to be answered rather than going. */
    lifespan: { type: Number, default: -1 },
    /** And can be dismissed without answering. */
    userClosable: { type: Boolean, default: true },
    /** Warning by default: something was undone-able, not something good. */
    intent: { type: String, default: "warning" },
  };

  /** The line, then the button that answers it. */
  drawContent() {
    return (
      <>
        <span styleName="text">{this.text}</span>
        <Button text="Undo" action="undo" />
      </>
    );
  }

  /** Say it was taken back, and go. */
  undo() {
    this.props.onUndo?.(this.self);
    this.close();
  }

  /**
   * Also tell whoever showed it that it has gone, whichever way it went.
   *
   * `reportClose` is the hook the base class keeps for exactly this — a
   * subclass hearing about a close without taking `action` away from an
   * application. Which is what it is for here: `action` is a directive in
   * markup and JSX alike, so it takes a method name and never a function,
   * and a caller working in JavaScript needs some other way to be told.
   */
  reportClose() {
    super.reportClose();
    this.props.onClosed?.(this.self);
  }
}


