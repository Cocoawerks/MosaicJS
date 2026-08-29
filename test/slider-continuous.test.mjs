// `continuous` on a slider, and what it means for the value rather than only
// for the action.
//
// A continuous slider is worth every place the knob passes through. One that is
// not reports where the knob came to rest — and now is worth that too: the knob
// follows the pointer, the slider goes on being worth what it was, and the
// value is written once when the drag settles. So a `<Bind/>` onto
// `slider.value` follows the same rule the action does, rather than seeing
// every step of a drag the page asked not to hear about.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

// The framework's sources are JSX, so these are the compiled modules — as
// bind.test.mjs does. Build first:
//   mosaic compile examples/Counter_component --keep-modules
const { mount, bind } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js"
);
const { RangeSlider, Slider } = await import(
  "../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js"
);

/** The shim has no layout, so a slider is given a track to be dragged along. */
function measure(slider) {
  slider.trackLength = () => 112;
  slider.node.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 112,
    bottom: 20,
    width: 112,
    height: 20,
    x: 0,
    y: 0,
  });
  return slider;
}

/**
 * A slider with a track, and the list of what its action reported.
 *
 * The track is 112px, which is 100 of run once the knob's overhang at each end
 * is taken off — so a pointer at `clientX` is worth `clientX - 6` on a slider
 * that runs from 0 to 100.
 */
function draggable(Type, props = {}) {
  const seen = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const slider = mount(Type, host, {
    ...props,
    action: (control, value) => seen.push(value),
  }).view;
  return { slider: measure(slider), seen };
}

/** A pointer event as the slider reads one, at a place along the track. */
function at(x, target = null) {
  return {
    clientX: x,
    clientY: 10,
    pointerId: 1,
    button: 0,
    target,
    preventDefault() {},
  };
}

/**
 * The knob's element, for reading what it says about itself.
 *
 * The presses below are all on the track rather than on the knob. Not because
 * a knob is not pressed in life, but because the shim has no layout: `grab()`
 * measures the knob to remember where the pointer took hold of it, and a knob
 * that measures to nothing at the origin makes every later move out by the
 * whole of where the press was. A press on the track at the place the knob
 * already sits is the same gesture without that.
 */
function knob(slider, i = 0) {
  return slider.handles[i].element;
}

test("a continuous slider is worth every place the drag passes through", () => {
  const { slider, seen } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
  });
  const target = { level: 0 };
  bind(slider, "value", target, "level");

  slider.pointerDown(at(46));
  slider.pointerMove(at(56));
  assert.equal(slider.value, 50, "the value moved with the knob");
  assert.equal(target.level, 50, "and what is bound to it followed");

  slider.pointerMove(at(76));
  assert.equal(target.level, 70);

  slider.pointerUp(at(76));
  assert.equal(slider.value, 70);
  assert.deepEqual(seen, [50, 70], "reported all the way");
});

test("a slider that is not continuous stays worth what it was until the drag settles", () => {
  const { slider, seen } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    continuous: false,
  });
  const target = { level: 0 };
  bind(slider, "value", target, "level");

  slider.pointerDown(at(46));
  slider.pointerMove(at(56));
  slider.pointerMove(at(76));

  assert.equal(slider.value, 40, "the slider is still worth what it was");
  assert.equal(target.level, 40, "so nothing bound to it has heard anything");
  assert.deepEqual(seen, [], "and the action has not fired");

  // But the knob went where it was dragged, or the drag showed nothing.
  assert.equal(slider.handles[0].shown, 70);
  assert.equal(
    slider.handles[0].element.getAttribute("aria-valuenow"),
    "70",
    "and a screen reader is told where the knob is",
  );

  slider.pointerUp(at(76));
  assert.equal(slider.value, 70, "written once, where it came to rest");
  assert.equal(target.level, 70, "and the binding heard it once");
  assert.deepEqual(seen, [70], "as did the action");
});

test("the value is written before the action is told about it", () => {
  let asked = null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const slider = measure(
    mount(Slider, host, {
      minValue: 0,
      maxValue: 100,
      value: 40,
      continuous: false,
      action: (control) => {
        asked = control.value;
      },
    }).view,
  );

  slider.pointerDown(at(46));
  slider.pointerMove(at(86));
  slider.pointerUp(at(86));

  assert.equal(asked, 80, "a handler asking the slider is told the new answer");
});

test("a drag that comes back to where it started is still reported", () => {
  const { slider, seen } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    continuous: false,
  });

  slider.pointerDown(at(46));
  slider.pointerMove(at(86));
  slider.pointerMove(at(46));
  slider.pointerUp(at(46));

  assert.equal(slider.value, 40);
  assert.deepEqual(seen, [40], "the gesture happened, whatever it came to");
});

test("a press on the track is part of the same gesture, not a change of its own", () => {
  const { slider, seen } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    continuous: false,
  });

  // Pressing the track jumps the knob there — and on a continuous slider that
  // is a value straight away. Here it waits with the rest of the drag.
  slider.pointerDown(at(26));
  assert.equal(slider.value, 40, "not yet");
  assert.equal(slider.handles[0].shown, 20, "though the knob went");

  slider.pointerMove(at(66));
  slider.pointerUp(at(66));
  assert.equal(slider.value, 60);
  assert.deepEqual(seen, [60], "one report for one gesture");
});

test("a press on the track of a continuous slider still takes the value at once", () => {
  const { slider } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
  });
  slider.pointerDown(at(26));
  assert.equal(slider.value, 20);
});

test("a cancelled gesture decides nothing and puts the knob back", () => {
  const { slider, seen } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    continuous: false,
  });

  slider.pointerDown(at(46));
  slider.pointerMove(at(86));
  slider.pointerCancel(at(86));

  assert.equal(slider.value, 40);
  assert.equal(slider.handles[0].shown, 40, "the knob went back");
  assert.deepEqual(seen, []);
});

test("the keyboard is not a drag, and commits as it always did", () => {
  const { slider } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    step: 5,
    continuous: false,
  });
  const target = { level: 0 };
  bind(slider, "value", target, "level");

  slider.keyDown({
    key: "ArrowRight",
    target: knob(slider),
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(slider.value, 45, "a step is a whole move, not part of one");
  assert.equal(target.level, 45);
});

test("assigning the value from code is unchanged", () => {
  const { slider } = draggable(Slider, {
    minValue: 0,
    maxValue: 100,
    value: 40,
    continuous: false,
  });
  const target = { level: 0 };
  bind(slider, "value", target, "level");

  slider.value = 90;
  assert.equal(target.level, 90);
});

test("two knobs still cannot pass each other mid-drag", () => {
  const { slider } = draggable(RangeSlider, {
    minValue: 0,
    maxValue: 100,
    start: 20,
    end: 60,
    continuous: false,
  });

  // Drag the near knob past the far one: it is stopped where the far one is
  // drawn, and the slider is worth neither until the drag settles.
  slider.handle = slider.startHandle;
  slider.dragging = true;
  slider.startHandle.dragToward(at(96));

  assert.equal(slider.startHandle.shown, 60, "held at its neighbour");
  assert.equal(slider.start, 20, "and worth nothing new yet");

  slider.pointerUp(at(96));
  assert.equal(slider.start, 60);
  assert.equal(slider.end, 60);
});
