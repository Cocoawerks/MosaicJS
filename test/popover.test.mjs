// PopOver, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
//
// There is no layout here, so where a popover lands is not what these check —
// that is checked in the browser, by the example's own page. What they check is
// what it does: when it is up, what puts it away, and whose controller its
// contents answer to.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {mount, h} = await import(
    "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
    );
const {PopOver, PopOverOrientation, closeTransientPopOvers} = await import(
    "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
    );

/** Mount a popover with something inside it, and something to hang it from. */
function open(props = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const anchor = document.createElement("button");
    document.body.appendChild(anchor);

    const view = mount(PopOver, host, {
        ...props,
        children: [h("input", {})],
    }).view;
    return {host, anchor, view, el: host.childNodes[0]};
}

const classesOf = (el) =>
    el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const calloutOf = (el) => el.childNodes[0];
const pressAt = (target) =>
    document.dispatchEvent({type: "pointerdown", target});
const typeKey = (key) => {
    let prevented = false;
    document.dispatchEvent({
        type: "keydown",
        key,
        preventDefault: () => (prevented = true),
    });
    return prevented;
};

// --- what it draws -----------------------------------------------------------

test("draws the ported markup: the panel, its callout and what it holds", () => {
    const {el} = open();

    assert.equal(el.tagName, "div");
    assert.equal(el.getAttribute("role"), "dialog");
    assert.equal(el.getAttribute("tabindex"), "0");
    assert.deepEqual(classesOf(el), ["v-PopOver"]);

    const callout = calloutOf(el);
    assert.equal(callout.tagName, "b");
    assert.equal(callout.childNodes[0].tagName, "b");
    assert.equal(el.childNodes[1].tagName, "input");
});

test("a shut popover is hidden from assistive tech and from the tab order", () => {
    const {el, view, anchor} = open();

    assert.equal(el.getAttribute("aria-hidden"), "true");
    assert.equal(el.getAttribute("inert"), "");

    view.show(anchor);
    assert.equal(el.getAttribute("aria-hidden"), null);
    assert.equal(el.getAttribute("inert"), null);
    assert.ok(classesOf(el).includes("is-open"));
});

test("the callout says which way it points", () => {
    const bottom = open().el;
    assert.deepEqual(classesOf(calloutOf(bottom)), [
        "PopOver-callout",
        "PopOver-callout--b",
        "PopOver-callout--center",
    ]);

    const right = open({orientation: PopOverOrientation.RIGHT_TOP}).el;
    assert.deepEqual(classesOf(calloutOf(right)), [
        "PopOver-callout",
        "PopOver-callout--r",
        "PopOver-callout--top",
    ]);
    assert.deepEqual(classesOf(calloutOf(right).childNodes[0]), [
        "PopOver-triangle",
        "PopOver-triangle--r",
    ]);
});

test("and is left out when the markup says so", () => {
    const {el} = open({callout: "false"});

    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout-none"));
    assert.ok(
        classesOf(calloutOf(el).childNodes[0]).includes("PopOver-triangle-none"),
    );
});

// --- showing and hiding ------------------------------------------------------

test("it starts away, shows against something, and puts itself away", () => {
    const {view, anchor} = open();

    assert.equal(view.visible, false);
    view.show(anchor);
    assert.equal(view.visible, true);
    view.hide();
    assert.equal(view.visible, false);

    view.toggle(anchor);
    assert.equal(view.visible, true);
    view.toggle(anchor);
    assert.equal(view.visible, false);
});

test("opening and closing reaches the action, once each way", () => {
    const said = [];
    const {view, anchor} = open({action: (popover, open) => said.push(open)});

    view.show(anchor);
    view.show(anchor);            // already up: nothing said
    view.hide();
    view.hide();                  // already away: nothing said
    assert.deepEqual(said, [true, false]);
});

test("a press outside puts it away; a press inside, or on its anchor, does not", () => {
    const {el, view, anchor} = open();
    view.show(anchor);

    pressAt(el.childNodes[1]);
    assert.equal(view.visible, true, "a press on what it holds");

    pressAt(anchor);
    assert.equal(view.visible, true, "a press on what it hangs from");

    pressAt(document.body);
    assert.equal(view.visible, false);
});

test("anything else excused is excused too", () => {
    const {view, anchor} = open();
    const menu = document.createElement("div");
    document.body.appendChild(menu);

    view.addCloseException(menu);
    view.show(anchor);
    pressAt(menu);
    assert.equal(view.visible, true);

    view.removeCloseException(menu);
    pressAt(menu);
    assert.equal(view.visible, false);
});

test("Escape puts it away, and goes no further", () => {
    const {view, anchor} = open();
    view.show(anchor);

    assert.ok(typeKey("Escape"), "the key is taken");
    assert.equal(view.visible, false);
});

test("a popover that is not transient sits until it is told otherwise", () => {
    const {view, anchor} = open({transient: "false"});
    view.show(anchor);

    pressAt(document.body);
    assert.equal(view.visible, true);

    // Escape is still its own: it belongs to whatever is on top.
    typeKey("Escape");
    assert.equal(view.visible, false);
});

test("and it hears nothing once it is away", () => {
    const {view, anchor} = open();
    view.show(anchor);
    view.hide();

    // Nothing to throw and nothing to act on: the listeners went with it.
    typeKey("Escape");
    pressAt(document.body);
    assert.equal(view.visible, false);
});

test("closeTransientPopOvers puts away everything that dismisses itself", () => {
    const first = open();
    const second = open();
    const kept = open({transient: "false"});

    first.view.show(first.anchor);
    second.view.show(second.anchor);
    kept.view.show(kept.anchor);

    closeTransientPopOvers();
    assert.equal(first.view.visible, false);
    assert.equal(second.view.visible, false);
    assert.equal(kept.view.visible, true, "one that stays is left alone");
    kept.view.hide();
});

// --- which side it lands on --------------------------------------------------
//
// There is no layout here, so the anchor is given a rect of its own and the
// popover a size: what these check is the choice of side, which is arithmetic.

/** Line a popover up with a box at `rect`, with a popover `size` big. */
function against(rect, size, props = {}) {
    const {view, anchor, el} = open(props);
    anchor.getBoundingClientRect = () => ({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        width: rect.width,
        height: rect.height,
    });
    Object.defineProperty(el, "offsetWidth", {value: size.width, configurable: true});
    Object.defineProperty(el, "offsetHeight", {value: size.height, configurable: true});

    view.alignWith(anchor);
    return {view, el, anchor};
}

test("alignWith is what lines it up and shows it", () => {
    const {view, anchor} = open();

    view.alignWith(anchor);
    assert.equal(view.visible, true);
    assert.equal(view.anchorElement, anchor);
});

test("it takes the side its orientation asked for, when there is room", () => {
    // The window is 1024 x 768 here; below a box at the top there is plenty.
    const {view, el} = against({left: 400, top: 100, width: 80, height: 30},
        {width: 200, height: 150});

    assert.equal(view.shownPosition, "bottom");
    assert.deepEqual(classesOf(calloutOf(el)), [
        "PopOver-callout",
        "PopOver-callout--b",
        "PopOver-callout--center",
    ]);
});

test("and the opposite side when that one has no room", () => {
    // Near the foot of the window: below the box there is nowhere to sit.
    const {view, el} = against({left: 400, top: 700, width: 80, height: 30},
        {width: 200, height: 150});

    assert.equal(view.shownPosition, "top");
    // The callout turns with it, so it still points at what it hangs from.
    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout--t"));
    assert.ok(classesOf(calloutOf(el).childNodes[0]).includes("PopOver-triangle--t"));
});

test("which way round it flips does not matter: top gives way to bottom", () => {
    const {view} = against({left: 400, top: 20, width: 80, height: 30},
        {width: 200, height: 150}, {orientation: PopOverOrientation.TOP_CENTER});

    assert.equal(view.shownPosition, "bottom");
});

test("and left gives way to right", () => {
    const {view} = against({left: 20, top: 300, width: 80, height: 30},
        {width: 200, height: 150}, {orientation: PopOverOrientation.LEFT_MIDDLE});

    assert.equal(view.shownPosition, "right");
});

test("right gives way to left", () => {
    const {view} = against({left: 900, top: 300, width: 80, height: 30},
        {width: 200, height: 150}, {orientation: PopOverOrientation.RIGHT_MIDDLE});

    assert.equal(view.shownPosition, "left");
});

test("it stays where it was told when neither side fits", () => {
    // Taller than the window: there is no side with room for it.
    const {view} = against({left: 400, top: 300, width: 80, height: 30},
        {width: 200, height: 900});

    assert.equal(view.shownPosition, "bottom");
});

test("a popover shown at a point takes the side it was told, having nothing to fit", () => {
    const {view} = against({left: 400, top: 700, width: 80, height: 30},
        {width: 200, height: 150});
    assert.equal(view.shownPosition, "top", "flipped while it hung from something");

    view.hide();
    view.showAt(10, 10);
    assert.equal(view.shownPosition, "bottom");
});

test("the callout is left out when it could not be aimed at the anchor", () => {
    // The window is 1024 x 768 here. A popover to the right of something at the
    // very foot of it is pushed back up to fit, and then its left edge runs
    // nowhere near the anchor: a callout would point at nothing.
    const {view, el} = against({left: 400, top: 760, width: 80, height: 30},
        {width: 200, height: 300}, {orientation: PopOverOrientation.RIGHT_MIDDLE});

    assert.equal(view.hasCallout, false);
    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout-none"));
    assert.ok(
        classesOf(calloutOf(el).childNodes[0]).includes("PopOver-triangle-none"),
        "the triangle goes with it",
    );
});

test("and when the popover ends up over what it hangs from", () => {
    // A window with room for it on neither side: told to sit above, it is pushed
    // back down until it covers the anchor, and a callout would point into the
    // popover itself. (768 tall here; the popover is 700.)
    const {view, el} = against({left: 400, top: 300, width: 80, height: 30},
        {width: 200, height: 700}, {orientation: PopOverOrientation.TOP_CENTER});

    assert.equal(view.shownPosition, "top", "neither side fits, so it stays put");
    assert.equal(view.hasCallout, false);
    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout-none"));
});

test("and comes back when the next showing can aim it", () => {
    const {view, el, anchor} = against({left: 400, top: 760, width: 80, height: 30},
        {width: 200, height: 300}, {orientation: PopOverOrientation.RIGHT_MIDDLE});
    assert.equal(view.hasCallout, false);

    // The same popover against something in the middle of the window, where
    // there is room to sit beside it.
    anchor.getBoundingClientRect = () => ({
        left: 400, top: 300, right: 480, bottom: 330, width: 80, height: 30,
    });
    view.hide();
    view.alignWith(anchor);

    assert.equal(view.hasCallout, true);
    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout--r"));
});

test("a popover told to draw no callout draws none either way", () => {
    const {view, el} = against({left: 400, top: 100, width: 80, height: 30},
        {width: 200, height: 150}, {callout: "false"});

    assert.equal(view.hasCallout, false);
    assert.ok(classesOf(calloutOf(el)).includes("PopOver-callout-none"));
});

// --- a popover of an application's own ---------------------------------------
//
// `Foo.mib` whose root is a PopOver, with `FooController.js` beside it: the
// compiler pairs the two, and the runtime gives each drawn one a controller of
// its own. These stand in for the compiled pair — a function with a
// `controller` is exactly what the compiler emits.

test("a page with a controller of its own is drawn against it", () => {
    class OwnController {
        constructor() {
            this.heading = "Pick a colour";
        }
    }

    function ColourPopOver() {
        return h("div", {}, this.heading);
    }

    ColourPopOver.controller = OwnController;

    // Drawn inside a page of its own: what it reads is its controller's, not the
    // heading the page above it happens to have.
    const host = document.createElement("div");
    mount(
        function Page() {
            return h(ColourPopOver, {});
        },
        host,
        {},
        {heading: "the page's own heading"},
    );

    assert.equal(host.childNodes[0].textContent, "Pick a colour");
});

test("mounted on its own, with nothing said, it still uses that controller", () => {
    class OwnController {
        constructor() {
            this.heading = "Pick a colour";
        }
    }

    function ColourPopOver() {
        return h("div", {}, this.heading);
    }

    ColourPopOver.controller = OwnController;

    const host = document.createElement("div");
    mount(ColourPopOver, host);
    assert.equal(host.childNodes[0].textContent, "Pick a colour");
});

test("a controller the caller names wins over the one written beside it", () => {
    class OwnController {
        constructor() {
            this.heading = "Pick a colour";
        }
    }

    function ColourPopOver() {
        return h("div", {}, this.heading);
    }

    ColourPopOver.controller = OwnController;

    const host = document.createElement("div");
    mount(ColourPopOver, host, {}, {heading: "the one the caller named"});
    assert.equal(host.childNodes[0].textContent, "the one the caller named");
});

test("and an outlet on it hands over that controller, not its element", () => {
    class OwnController {
        hello() {
            return "hello";
        }
    }

    function ColourPopOver() {
        return h("div", {});
    }

    ColourPopOver.controller = OwnController;

    const page = {};
    const host = document.createElement("div");
    mount(
        function Page() {
            return h(ColourPopOver, {ref: (it) => (this.colours = it)});
        },
        host,
        {},
        page,
    );

    assert.ok(page.colours instanceof OwnController);
    assert.equal(page.colours.hello(), "hello");
});

test("a page without one is drawn against the controller above it", () => {
    function Plain() {
        return h("div", {}, this.heading);
    }

    const host = document.createElement("div");
    mount(Plain, host, {}, {heading: "the page's own heading"});
    assert.equal(host.childNodes[0].textContent, "the page's own heading");
});
