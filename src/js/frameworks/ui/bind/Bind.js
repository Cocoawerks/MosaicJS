// Bind, the binding written as markup: a tag that joins one property to
// another and draws nothing at all.
//
//   <Slider outlet="slider" value="40"/>
//   <TextField outlet="sliderValueLabel"/>
//
//   <Bind source="slider.value" target="sliderValueLabel.value"/>
//
// Both are paths from the scope of the `.ib.xml` the tag is written in, in the
// way a `{binding}` is: a name on its own is a property of that scope, and a
// dotted one goes through what it holds — an outlet, most often, since an
// outlet *is* a property of the scope.
//
//   <Bind source="slider.value" target="volume"/>        <!-- to the controller -->
//   <Bind source="volume" target="spin.value" twoway/>   <!-- and back again -->
//
// A `.ib.xml` and its controller are one scope, not two: the controller is what
// the markup draws against, and its outlets are assigned onto it. So a path
// reaches the page's own state and the controls it placed by the same names
// the controller uses.
//
// And it reaches nothing else. A composed `.ib.xml` keeps a scope of its own, so
// a page cannot name the controls inside one — it names the view it placed,
// and goes through that:
//
//   <!-- MyDialog.ib.xml -->            <!-- the page that places it -->
//   <ComboBox outlet="combo1"/>      <MyDialog outlet="mydialog"/>
//                                    <Bind source="mydialog.combo1.value"
//                                          target="chosenColor"/>
//
// which is the same rule the other way about: a Bind written *inside*
// MyDialog.ib.xml says `combo1.value`, and cannot see the page above it. Each
// file joins up what it placed, and nothing reaches across.
//
// Written this way the joins are in the page beside the things they join,
// rather than in a controller method that has to be read to find out what the
// page does. What it comes to is `bind()`, which is what a controller would
// call; a page that wants a transform still calls it there.
import { Component, bind, bindTwoWay, observeKey } from "mosaic";

/** What the compiler hands over — see BIND_TAG in the compiler's js.js. */
const SCOPE_PROP = "scope";

/**
 * What the page's controller actually holds, for a path that named something
 * it does not — which is nearly always an outlet spelled one way in the markup
 * and another in the Bind.
 */
function whatItHas(controller) {
  // The framework puts a couple of things on a controller of its own; they
  // are not what anyone meant to bind to.
  const own = new Set(["view", "isAttached"]);
  const named = Object.keys(controller ?? {})
    .filter((key) => !own.has(key) && !key.startsWith("_"))
    // Not the ones holding nothing: watching for a name that has not turned up
    // defines it, and listing it back would be reporting the thing being
    // looked for as though it were there.
    .filter((key) => controller[key] !== undefined)
    .sort();
  return named.length > 0
    ? `The controller has: ${named.join(", ")}.`
    : `The controller has nothing on it at all — no outlet reached it.`;
}

export default class Bind extends Component {
  static props = {
    /** The property that pushes, as a path from the controller. */
    source: { type: String, default: "" },
    /** The property that follows, likewise. */
    target: { type: String, default: "" },
    /**
     * Whether the two follow each other, rather than the target following the
     * source. `source` is still the one that wins to begin with.
     */
    twoway: { type: Boolean, default: false },
    /**
     * What the paths are read against, handed over by the compiler: the scope
     * of the `.ib.xml` the tag was written in. Not something to write by hand —
     * a Bind placed from JavaScript, where there is no file to belong to,
     * looks for the nearest scope around it instead.
     */
    scope: { type: Object },
  };

  /**
   * Nothing. A binding is not a thing on the page, and the comment this leaves
   * behind is only somewhere to stand: it is what tells the runtime the tag is
   * on screen, and what the controller is found from.
   */
  draw() {
    return null;
  }

  /**
   * Joined once the page is on screen — or once whatever it names turns up.
   *
   * An outlet is assigned as the markup draws, so ordinarily everything a Bind
   * names exists by the time it is attached. Not always: a control inside
   * something drawn later, a page that fills an outlet when it opens, an
   * outlet assigned by hand. A Bind that refused those would be refusing a
   * path that is about to be perfectly good.
   *
   * So a path that leads nowhere is waited for rather than refused: the first
   * step of it is watched on the controller, and the join is made the moment
   * something is put there. Outlets are properties of the controller like any
   * other, which is what makes this possible at all.
   *
   * Nothing is thrown for it. A page whose tag names something that never
   * arrives says so once, plainly, and goes on running — a binding that did
   * not happen is not worth taking an application down for, and a page that
   * threw here would take one down on load.
   */
  attached() {
    if (!this.source || !this.target) {
      throw new Error(
        `<Bind/> needs both a source and a target: ` +
          `source="${this.source}" target="${this.target}"`,
      );
    }
    if (!this.join()) this.waitFor();
  }

  /**
   * Try the join.
   *
   * @returns {boolean} whether it is joined.
   */
  join() {
    // Always an error, never a wait: `attachTree` tells children before
    // parents and the page is in the document by then, so a controller that
    // is not above this tag now will not appear later.
    const controller = this.controllerAbove();
    if (!controller) {
      throw new Error(
        `<Bind source="${this.source}"/> is not inside anything that has a ` +
          `controller. A Bind reads its paths from the page's controller, so ` +
          `it belongs in a .ib.xml that has one — a Foo.ib.xml with a ` +
          `FooController.js beside it.`,
      );
    }

    try {
      this.undo = this.twoway
        ? bindTwoWay(controller, this.source, controller, this.target)
        : bind(controller, this.source, controller, this.target);
      return true;
    } catch (e) {
      this.refused = e;
      return false;
    }
  }

  /**
   * Watch for whatever the paths named, and join when it arrives.
   *
   * The head of each path is what is watched — `combo1` of `combo1.value` —
   * since that is the property of the controller an outlet is assigned to. A
   * path of one step names a property of the controller itself, which is
   * always there to be bound to, so only the deeper ones ever wait.
   */
  waitFor() {
    const controller = this.controllerAbove();
    const heads = [this.source, this.target]
      .map((path) => path.split(".")[0])
      .filter((head, i, all) => all.indexOf(head) === i);

    const retry = () => {
      if (!this.isAttached || this.undo) return;
      if (this.join()) this.stopWaiting();
    };

    this.stoppers = heads.map((head) => {
      observeKey(controller, head, retry);
      return () => observeKey.stop(controller, head, retry);
    });

    // And said once, so a name that is simply wrong is not a silent nothing.
    this.reported = setTimeout(() => {
      this.reported = null;
      if (this.undo) return;
      console.error(
        `<Bind source="${this.source}" target="${this.target}"/>: ` +
          `${this.refused?.message ?? "could not be joined"}\n    ` +
          `${whatItHas(controller)}\n    ` +
          `A path reaches into a composed .ib.xml through the outlet it was placed ` +
          `under — "someView.control.value" — since that view keeps its own ` +
          `outlets.\n    ` +
          `Still watching, in case it turns up.`,
      );
    }, 0);
  }

  stopWaiting() {
    for (const stop of this.stoppers ?? []) stop();
    this.stoppers = null;
    clearTimeout(this.reported);
    this.reported = null;
  }

  /** A binding holds both of its ends, so it goes when the page does. */
  detached() {
    this.undo?.();
    this.undo = null;
    this.stopWaiting();
    super.detached?.();
  }

  /**
   * The controller of the page this tag was written in.
   *
   * Found by walking up from where it stands rather than being handed down: a
   * compiled `.ib.xml` tags the element it drew with the scope it drew against,
   * so the nearest one above is the page that placed this tag. A Bind inside a
   * page inside another page therefore reads the paths of the page it is
   * written in, which is the only reading that makes sense.
   */
  controllerAbove() {
    // What the compiler said, which is the file the tag was written in. The
    // paths belong to that file whatever the tag is nested inside — a dialog,
    // another view — so nothing is searched for when it is known.
    const stated = this.props?.[SCOPE_PROP];
    if (stated) return stated;

    // A compiled `.ib.xml`'s scope, wherever it is: looked for all the way up
    // before anything else is considered. A component standing between this
    // tag and its page has a `controller` of its own — itself, as it happens —
    // and taking that one because it came first would hand the Bind an object
    // with none of the page's outlets on it.
    for (let node = this.node; node; node = node.parentNode) {
      if (node.__ibCtl) return node.__ibCtl;
    }
    // Failing that, a page written as a class rather than as markup.
    for (let node = this.node; node; node = node.parentNode) {
      const view = node.__ibView;
      if (
        view &&
        view !== this &&
        view.controller &&
        view.controller !== view
      ) {
        return view.controller;
      }
    }
    return null;
  }
}
