// SnackBar, Toast and SnackBarManager, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const {h} = await import(
    "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
    );
const {SnackBar, SnackBarManager, SnackBarPosition, Toast} = await import(
    "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
    );

const classesOf = (el) =>
    el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent({type: "click"});

/** A manager whose bars appear at once, so a test can look at them. */
function manager(position = SnackBarPosition.BOTTOM_RIGHT, {animated = false} = {}) {
    const bars = new SnackBarManager(position);
    bars.allowsAnimation = animated;
    return bars;
}

/** The layer's element, and the bars on it. */
const layerOf = (bars) => bars.host.childNodes[0];
const barsOn = (bars) =>
    layerOf(bars).childNodes.map((slot) => slot.childNodes[0]);

// --- the layer ---------------------------------------------------------------

test("nothing is put on the page until there is something to show", () => {
    const bars = manager();

    assert.equal(bars.host, undefined);

    bars.toast("Saved");
    assert.ok(document.body.childNodes.includes(bars.host));
    assert.ok(classesOf(layerOf(bars)).includes("v-SnackBar-container"));

    bars.dispose();
});

test("the layer is pinned to the edges its position names", () => {
    const cases = [
        [SnackBarPosition.BOTTOM_RIGHT, ["bottom", "right"]],
        [SnackBarPosition.TOP_LEFT, ["top", "left"]],
        [SnackBarPosition.TOP_CENTER, ["top", "left", "right"]],
    ];

    for (const [position, expected] of cases) {
        const bars = manager(position);
        bars.toast("Saved");

        const classes = classesOf(layerOf(bars));
        assert.deepEqual(
            expected.filter((side) => classes.includes(side)),
            expected,
            `${position} is pinned to ${expected.join(" and ")}`,
        );
        bars.dispose();
    }
});

test("a bar is stacked nearest the edge the layer is pinned to", () => {
    const bottom = manager(SnackBarPosition.BOTTOM_RIGHT);
    bottom.toast("first");
    bottom.toast("second");
    assert.deepEqual(barsOn(bottom).map((bar) => bar.textContent), ["first", "second"]);

    const top = manager(SnackBarPosition.TOP_RIGHT);
    top.toast("first");
    top.toast("second");
    assert.deepEqual(
        barsOn(top).map((bar) => bar.textContent),
        ["second", "first"],
        "a top stack grows downwards from the newest",
    );

    bottom.dispose();
    top.dispose();
});

// --- a bar -------------------------------------------------------------------

test("a toast says its line, and carries no close button", () => {
    const bars = manager();
    bars.toast("Everything was saved");

    const bar = barsOn(bars)[0];
    assert.ok(classesOf(bar).includes("v-SnackBar"));
    assert.ok(classesOf(bar).includes("v-Toast"));
    assert.equal(bar.getAttribute("role"), "status");
    assert.equal(bar.textContent, "Everything was saved");
    assert.equal(bar.querySelectorAll("button").length, 0);

    bars.dispose();
});

test("an intent is worn as itself and as `intent`, which the sheets share", () => {
    const bars = manager();
    bars.toast("Gone wrong", "danger");

    const classes = classesOf(barsOn(bars)[0]);
    assert.ok(classes.includes("intent"));
    assert.ok(classes.includes("danger"));

    bars.toast("Nothing special");
    assert.equal(classesOf(barsOn(bars)[1]).includes("intent"), false);

    bars.dispose();
});

test("a snackbar shows what it was given, and can be closed by hand", () => {
    const bars = manager();
    bars.show(h(SnackBar, {lifespan: "-1"}, h("span", {}, "Undo that?")));

    const bar = barsOn(bars)[0];
    assert.equal(bar.textContent.includes("Undo that?"), true);

    const close = bar.querySelectorAll("button")[0];
    assert.ok(close, "which is a close button");
    click(close);

    assert.equal(bars.count, 0, "and it goes at once when nothing is animated");
    bars.dispose();
});

test("a bar that is not user-closable is drawn without the button", () => {
    const bars = manager();
    bars.show(h(SnackBar, {userClosable: "false"}, h("span", {}, "No way out")));

    assert.equal(barsOn(bars)[0].querySelectorAll("button").length, 0);
    bars.dispose();
});

test("it says so when it goes, whoever closed it", () => {
    const bars = manager();
    const closed = [];
    bars.show(h(SnackBar, {action: () => closed.push("gone")}, h("span", {}, "Saved")));

    bars.bars[0].view.close();
    assert.deepEqual(closed, ["gone"]);
    assert.equal(bars.count, 0);

    bars.dispose();
});

// --- how long it stays -------------------------------------------------------

test("a bar goes on its own once its lifespan is up", async () => {
    const bars = manager();
    bars.toast("Saved", "default", {lifespan: "0.05"});

    assert.equal(bars.count, 1);
    await wait(120);
    assert.equal(bars.count, 0);

    bars.dispose();
});

test("and one with a lifespan of -1 stays until something closes it", async () => {
    const bars = manager();
    bars.show(h(SnackBar, {lifespan: "-1"}, h("span", {}, "Still here")));

    await wait(120);
    assert.equal(bars.count, 1);

    bars.closeAll();
    assert.equal(bars.count, 0, "closeAll closes them properly, rather than hiding them");

    bars.dispose();
});

// --- coming and going --------------------------------------------------------

test("an animated bar is placed off screen and then told to come in", async () => {
    const bars = manager(SnackBarPosition.BOTTOM_RIGHT, {animated: true});
    bars.toast("Saved", "default", {lifespan: "-1"});

    assert.ok(classesOf(barsOn(bars)[0]).includes("v-SnackBar-enter"));

    await wait(60);
    const classes = classesOf(barsOn(bars)[0]);
    assert.ok(classes.includes("v-SnackBar-appear"));
    assert.equal(classes.includes("v-SnackBar-enter"), false);

    bars.dispose();
});

test("and it fades before it goes, keeping its place until it has", async () => {
    const bars = manager(SnackBarPosition.BOTTOM_RIGHT, {animated: true});
    bars.toast("Saved", "default", {lifespan: "-1"});
    await wait(60);

    bars.bars[0].view.close();
    assert.ok(classesOf(barsOn(bars)[0]).includes("v-SnackBar-exit"));
    assert.equal(bars.count, 1, "still on the page while it fades");

    await wait(460);
    assert.equal(bars.count, 0);

    bars.dispose();
});

test("closing twice closes it once", async () => {
    const bars = manager();
    const closed = [];
    bars.show(h(Toast, {text: "Saved", action: () => closed.push("gone")}));

    const bar = bars.bars[0].view;
    bar.close();
    bar.close();
    assert.deepEqual(closed, ["gone"]);

    bars.dispose();
});
