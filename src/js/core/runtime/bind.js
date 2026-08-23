// Binding one object's property to another's.
//
// A control's value, a controller's field, a label's text: any of them can be
// told to follow any other, so the thing that changes and the thing that shows
// it are joined once rather than wired up in a handler each time.
//
//   bind(this.slider, "value", this.volumeLabel, "text");
//   bind(this.nameField, "value", this, "name");
//
// Either side may be named by a path rather than a property, which is the same
// thing said from further out — a controller and the way through it to what is
// meant. These two are the pair above, written from the controller:
//
//   bind(this, "slider.value", this, "volumeLabel.text");
//   bind(this, "nameField.value", this, "name");
//
// A binding is one-way — the source pushes, the target receives. Two of them
// facing each other make it two-way, which is what `bindTwoWay` is:
//
//   bindTwoWay(this.slider, "value", this.spinButton, "value");
//
// What it is built on is the same observation the rest of the runtime uses: a
// `{path}` in markup and a drawn view's reads both come down to "run this when
// that property is assigned", and so does this. So a binding onto a controller
// property that a page also binds updates the page as well, without either
// knowing about the other.
import { isObservable, observe, unobserve } from "./private/observe.js";

/**
 * Make `target[targetKey]` follow `source[sourceKey]`.
 *
 * The target is brought into agreement at once — binding two things together
 * and leaving them disagreeing until the next change would be a trap — and
 * again on every assignment to the source after that.
 *
 * `transform` is what the value becomes on the way across, for a target that
 * wants it in other terms: a number as the text that reads it, a state as the
 * class that shows it.
 *
 *   bind(slider, "value", label, "text", (v) => `${v}%`);
 *
 * Either side may be a component or a plain object — a controller is a plain
 * object, and binding onto one of its properties is how a page's `{bindings}`
 * come to hear about a control.
 *
 * @param {object} source     what is watched, or what the path starts at
 * @param {string} sourceKey  the property watched on it — `"value"`, or a
 *   path through it to the property, `"slider.value"`
 * @param {object} target     what follows it
 * @param {string} [targetKey] the property assigned, the same name by default
 * @param {(value: *, source: object, target: object) => *} [transform]
 * @returns {() => void} undoes the binding. A binding holds both objects, so
 *   one whose ends outlive it has to be undone or they are kept alive with it.
 */
export function bind(
  source,
  sourceKey,
  target,
  targetKey = sourceKey,
  transform = null,
) {
  const from = at("bind", "source", source, sourceKey);
  const to = at("bind", "target", target, targetKey);

  const link = link1(from.object, from.key, to.object, to.key, transform);
  link.apply();
  return link.undo;
}

/**
 * Bind two properties to each other, so a change to either reaches the other:
 * `bind` twice, facing.
 *
 * `to` is what a value becomes going from the first to the second, and `from`
 * what it becomes coming back — a pair that should undo each other, or the two
 * will not settle on the same thing.
 *
 * The first is the one that wins to begin with: both start out holding what
 * `a[aKey]` holds, since that is the direction bound first.
 *
 * @param {object} a
 * @param {string} aKey
 * @param {object} b
 * @param {string} [bKey] the property on `b`, the same name by default
 * @param {{to?: Function, from?: Function}} [options]
 * @returns {() => void} undoes both directions.
 */
export function bindTwoWay(a, aKey, b, bKey = aKey, options = {}) {
  const first = at("bindTwoWay", "first", a, aKey);
  const second = at("bindTwoWay", "second", b, bKey);

  const there = link1(
    first.object,
    first.key,
    second.object,
    second.key,
    options.to ?? null,
  );
  const back = link1(
    second.object,
    second.key,
    first.object,
    first.key,
    options.from ?? null,
  );

  // Bound before either is applied, so the seeding below is already protected
  // by the same guard every later change is: `a` pushing its value into `b`
  // must not come straight back as `b` pushing it into `a`.
  there.pairWith(back);
  back.pairWith(there);

  there.apply();

  return () => {
    there.undo();
    back.undo();
  };
}

/**
 * One direction of a binding.
 *
 * The guard is what keeps a mutual pair from ringing forever. A component's
 * setter is wrapped where it stands and told about every assignment, changed
 * value or not — the equality check that spares a plain field belongs to the
 * field's own accessor and there is none here — so `a` telling `b` would have
 * `b` telling `a`, for as long as the stack held. A link that is already
 * pushing refuses to be pushed.
 *
 * Per link rather than one flag for all of them: a chain — a slider to a
 * label, that label to something else — is three links deep on purpose, and a
 * single flag would stop it at the first.
 */
function link1(source, sourceKey, target, targetKey, transform) {
  let busy = false;
  let opposite = null;

  const apply = () => {
    if (busy || opposite?.isBusy()) return;
    busy = true;
    try {
      const value = source[sourceKey];
      target[targetKey] = transform ? transform(value, source, target) : value;
    } finally {
      busy = false;
    }
  };

  observe(source, sourceKey, apply);

  return {
    apply,
    isBusy: () => busy,
    pairWith: (other) => {
      opposite = other;
    },
    undo: () => unobserve(source, sourceKey, apply),
  };
}

/**
 * Whether a property can push: one with no setter is never assigned, so
 * nothing can be told it changed.
 *
 * A binding from one is not refused — the value is still copied across when
 * the binding is made, which is what a caller reading a fixed thing wants —
 * but it will not be copied again, and this is how to find that out.
 *
 * @returns {boolean}
 */
export function canPush(source, sourceKey) {
  const from = at("canPush", "source", source, sourceKey);
  return isObservable(from.object, from.key);
}

/**
 * What a path names: the object holding the property, and the property.
 *
 * `"value"` is the property on the object given; `"slider.value"` is the
 * property on what `slider` holds. The way through is walked once, when the
 * binding is made — a binding follows a property, not a path, and swapping out
 * what `slider` holds afterwards leaves the binding on the old one. Bind again
 * if that is a thing that happens.
 *
 * @returns {{object: object, key: string}}
 */
function at(what, which, root, path) {
  if (!root || (typeof root !== "object" && typeof root !== "function")) {
    throw new TypeError(`${what}: the ${which} must be an object`);
  }
  if (typeof path !== "string" || path === "") {
    throw new TypeError(`${what}: the ${which} needs a property to bind`);
  }

  const steps = path.split(".");
  const key = steps.pop();
  let object = root;
  for (let i = 0; i < steps.length; i++) {
    object = object?.[steps[i]];
    if (
      !object ||
      (typeof object !== "object" && typeof object !== "function")
    ) {
      throw new TypeError(
        `${what}: the ${which} "${path}" has nothing at "${steps
          .slice(0, i + 1)
          .join(".")}"`,
      );
    }
  }
  return { object, key };
}

/**
 * Watch one property, without binding anything to it.
 *
 * What a `<Bind/>` uses to wait for what it names: an outlet is a property of
 * the controller like any other, so a tag whose path leads nowhere yet can
 * watch the head of that path and join the moment something is put there.
 *
 * `observeKey.stop` takes the watch off again.
 */
export function observeKey(target, key, run) {
  observe(target, key, run);
}

observeKey.stop = function stop(target, key, run) {
  unobserve(target, key, run);
};
