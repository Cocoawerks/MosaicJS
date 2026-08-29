// The tag that is not a view: instantiating a plain JavaScript object from
// markup.
//
// A `.ib.xml` has always been able to place a component — something with a
// `draw()`, which becomes part of the interface. Plenty of what an interface is made of
// is not that. A formatter, a validator, a document, the thing that fetches
// the rows a list shows: objects an owner would otherwise build by hand in
// `awakeFromMib()`, which puts half of what the interface is made of somewhere the
// interface does not show it.
//
//   <NumberFormatter outlet="money" style="currency" currency="GBP"/>
//   <SensorFeed outlet="feed" url="/api/live"/>
//
//   <Bind source="feed.latest" target="readout.value"/>
//
// The tag names a module the way any other tag does — `NumberFormatter.js`
// beside the markup, or anywhere the build can see — and what it exports
// decides what happens to it:
//
//   a class with `draw()`   a component, drawn into the interface, as before
//   any other class         constructed here, and *not* drawn
//   an object               taken as it is — a singleton the interface reaches
//   a function              a component function, as before
//
// A function is the one thing that cannot be told apart: a plain function is
// how a hand-written component is written, so a factory cannot have the tag
// without taking a component's meaning away. Write it as a class.
//
// What the tag says is put on the object — twice over, in the sense that the
// constructor is handed the props as well, so a class that wants them at
// construction has them and one that would rather have properties assigned
// gets that too. What the interface assigns later — through the outlet, through a
// `<Bind/>` — is what wins after that, exactly as it is for a composed view.
//
// An object tag draws nothing. It leaves behind a comment naming what it is,
// which is somewhere for the runtime to stand: the outlet points at the
// object, but the *node* is what tells the runtime the tag is on screen and
// what to take down when the interface goes. Children of an object tag are not
// rendered — there is nothing to render them into.
import { isComponentClass } from "./draw.js";
import { applyProps } from "./scope.js";

/**
 * Is `type` a class rather than a function?
 *
 * Read off its source, which is the only thing that separates the two: both
 * are functions, and a class differs by refusing to be called without `new` —
 * which is precisely the failure this exists to avoid, so it cannot be the
 * test. A minifier renames a class but never stops writing `class`.
 */
function isClass(type) {
  return /^class[\s{]/.test(Function.prototype.toString.call(type));
}

/**
 * Is `type` a tag that names an object rather than a view?
 *
 * A component class is not one, however it is written: `draw()` is what says
 * "this belongs on the interface", and it is asked first so a component whose
 * class this would otherwise claim keeps its meaning.
 *
 * @param {*} type what the tag resolved to
 * @returns {boolean}
 */
export function isObjectTag(type) {
  if (type === null || type === undefined) return false;
  if (typeof type === "object") return true;
  if (typeof type !== "function") return false;
  if (isComponentClass(type)) return false;
  return isClass(type);
}

/**
 * The object a tag names: a class is constructed, an object is taken as it
 * stands.
 *
 * A tag naming an object rather than a class places the same object every
 * time — a service, a store, something there is deliberately one of. Nothing
 * is copied, so two interfaces naming it share it, which is the point of writing it
 * that way.
 *
 * @param {Function|object} type what the tag resolved to
 * @param {object} props what the tag says
 * @returns {{object: object, applied: object}} the object, and the props put
 *   on it, to compare against on the next draw.
 */
export function instantiate(type, props) {
  const object = typeof type === "function" ? new type(props) : type;
  const applied = applyProps(object, props);
  return { object, applied };
}

/**
 * Something for an object tag to leave behind: a comment naming what it
 * placed.
 *
 * Named rather than empty because this is what shows up in the inspector where
 * the tag was written, and "what is this comment" is a fair question of an interface
 * that appears to have nothing there.
 *
 * A class knows its own name and an instance can be asked for its class's. A
 * module exporting an object literal knows neither — `Rates` is the name of a
 * binding in a file, and nothing of it survives into the value — so that one
 * is named for what it is rather than for what it was called.
 */
export function placeholder(type) {
  const name =
    typeof type === "function" ? type.name : type?.constructor?.name;
  return document.createComment(
    name && name !== "Object" ? ` ${name} ` : " object ",
  );
}
