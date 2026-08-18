// Minimal DOM good enough to exercise the runtime under plain node.
// Not a browser: it implements only what mosaic.js touches.

class N {
  /** The DOM's own numbering, which the runtime and the components compare against. */
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;
  static COMMENT_NODE = 8;
  static DOCUMENT_FRAGMENT_NODE = 11;

  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(child) {
    if (child instanceof Frag) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      child.childNodes = [];
      return child;
    }
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, ref) {
    if (child instanceof Frag) {
      for (const c of [...child.childNodes]) this.insertBefore(c, ref);
      child.childNodes = [];
      return child;
    }
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, child);
    else this.childNodes.push(child);
    return child;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === document.body || n === document.head;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(v) {
    this.childNodes = [];
    if (v !== "") this.appendChild(new Text(String(v)));
  }

  get innerHTML() {
    return this.childNodes.map((c) => c.outerHTML ?? c.textContent).join("");
  }
}

/**
 * A node that holds no children — text and comments. The browser refuses to
 * append to one (HierarchyRequestError), and so does this: a runtime bug that
 * reaches for the wrong parent has to fail here too, or it only shows up in a
 * browser. One did, patching a fragment's children into the comment standing
 * in for an absent sibling.
 */
class Leaf extends N {
  appendChild() {
    throw new TypeError(
      `appendChild on a ${this.constructor.name.toLowerCase()} node: it holds no children`,
    );
  }

  insertBefore() {
    throw new TypeError(
      `insertBefore on a ${this.constructor.name.toLowerCase()} node: it holds no children`,
    );
  }
}

class Text extends Leaf {
  nodeType = N.TEXT_NODE;

  constructor(data) {
    super();
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(v) {
    this.data = String(v);
  }

  get outerHTML() {
    return this.data;
  }
}

class Comment extends Text {
  nodeType = N.COMMENT_NODE;

  get outerHTML() {
    return `<!--${this.data}-->`;
  }

  get textContent() {
    return "";
  }
}

class Frag extends N {
  nodeType = N.DOCUMENT_FRAGMENT_NODE;
}

const VOID = new Set(["br", "img", "input", "hr", "meta", "link"]);

/**
 * Elements that hold a value as a property rather than as an attribute.
 * `<option>` is not one: its value reflects the attribute, in a browser too.
 */
const VALUE_ELEMENTS = new Set(["input", "select", "textarea"]);

class Element extends N {
  nodeType = N.ELEMENT_NODE;

  constructor(tag) {
    super();
    this.tagName = tag;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.attributes = new Map();
    this.listeners = new Map();
    // The runtime assigns `el.value` when the element has one, which is how a
    // native control is driven; without it the property would land as an
    // attribute and a control would read back undefined.
    if (VALUE_ELEMENTS.has(tag)) this.value = "";
    this.style = {
      setProperty(k, v) {
        this[k] = v;
      },
    };
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === "id") this.id = String(v);
  }

  removeAttribute(k) {
    this.attributes.delete(k);
  }

  getAttribute(k) {
    return this.attributes.get(k) ?? null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const fns = this.listeners.get(type);
    if (!fns) return;
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
  }

  /**
   * Everything measures to nothing: there is no layout here. A component that
   * places itself reads a rect and gets zeros, which is a coherent answer —
   * what is checked in these tests is what it does, not where it lands.
   */
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    };
  }

  get offsetWidth() {
    return 0;
  }

  get offsetHeight() {
    return 0;
  }

  /** Whether this element answers to `sel` — the same few forms as below. */
  matches(sel) {
    return matches(this, sel);
  }

  /** This element or the nearest one above it that answers to `sel`. */
  closest(sel) {
    for (let n = this; n; n = n.parentNode) {
      if (n instanceof Element && matches(n, sel)) return n;
    }
    return null;
  }

  /** Whether `node` is this element or sits somewhere inside it. */
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  dispatchEvent(ev) {
    // Events bubble, as they do in a browser: a control listens on the element
    // it drew, and what the user works may be a node inside it. `bubbles:
    // false` opts out, for the handful of events that do not.
    if (ev.target === undefined) ev.target = this;
    // And a handler can stop them going further, which is how a component
    // nested in another keeps a click to itself. A test may pass its own
    // stopPropagation to see that one was called; this only fills one in.
    let stopped = false;
    if (ev.stopPropagation === undefined)
      ev.stopPropagation = () => (stopped = true);
    for (let node = this; node; node = node.parentNode) {
      for (const fn of node.listeners?.get(ev.type) ?? []) fn(ev);
      if (ev.bubbles === false || stopped) break;
    }
  }

  /** Press it, as `HTMLElement.click()` does — the event bubbles like any other. */
  click() {
    this.dispatchEvent({ type: "click" });
  }

  focus() {
    if (document.activeElement === this) return;
    document.activeElement?.blur();
    document.activeElement = this;
    this.dispatchEvent({ type: "focus" });
  }

  blur() {
    if (document.activeElement !== this) return;
    document.activeElement = null;
    this.dispatchEvent({ type: "blur" });
  }

  get ownerDocument() {
    return document;
  }

  /** The classes on this element, as the DOM's own list works. */
  get classList() {
    const read = () =>
      (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const write = (names) => this.setAttribute("class", names.join(" "));
    return {
      contains: (name) => read().includes(name),
      add: (name) => {
        const names = read();
        if (!names.includes(name)) write([...names, name]);
      },
      remove: (name) => write(read().filter((n) => n !== name)),
      toggle: (name, on) => {
        const wanted = on === undefined ? !read().includes(name) : on;
        if (wanted) this.classList.add(name);
        else this.classList.remove(name);
        return wanted;
      },
    };
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c instanceof Element) {
          if (matches(c, sel)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }

  get outerHTML() {
    const attrs = [...this.attributes].map(([k, v]) => ` ${k}="${v}"`).join("");
    if (VOID.has(this.tagName)) return `<${this.tagName}${attrs}>`;
    return `<${this.tagName}${attrs}>${this.innerHTML}</${this.tagName}>`;
  }
}

/**
 * Supports `tag`, `.class`, `[attr]`, `:not(...)` and any of them together —
 * all the tests need, and all the components ask of `closest()`.
 */
function matches(el, sel) {
  // `:not(...)` is peeled off first and checked as its own selector, so the
  // part left is the plain compound the regex below understands. A dialog
  // looks for `.v-Button.primary:not(.is-disabled)`.
  let rest = sel.trim();
  for (const negation of rest.matchAll(/:not\(([^)]*)\)/g)) {
    if (matches(el, negation[1])) return false;
  }
  rest = rest.replace(/:not\([^)]*\)/g, "");

  const m = /^([a-z0-9-]+)?((?:\.[\w-]+)*)?(?:\[([^\]=]+)\])?$/i.exec(rest);
  if (!m) return false;
  const [, tag, classes, attr] = m;
  if (tag && el.tagName !== tag) return false;
  if (attr && !el.attributes.has(attr)) return false;
  if (classes) {
    const on = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    for (const name of classes.split(".").filter(Boolean)) {
      if (!on.includes(name)) return false;
    }
  }
  return true;
}

const document = {
  head: new Element("head"),
  body: new Element("body"),
  activeElement: null,
  createElement: (t) => new Element(t),
  // The runtime creates an <svg> and its children in the SVG namespace; the
  // element is otherwise the same, and remembering it is what lets a test see
  // that the namespace was right.
  createElementNS: (ns, t) => {
    const el = new Element(t);
    el.namespaceURI = ns;
    return el;
  },
  createTextNode: (d) => new Text(d),
  createComment: (d) => new Comment(d),
  createDocumentFragment: () => new Frag(),
  querySelectorAll: (sel) => document.body.querySelectorAll(sel),
  getElementById(id) {
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c instanceof Element) {
          if (c.id === id) return c;
          const found = walk(c);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(document.body);
  },
  querySelector(sel) {
    if (sel.startsWith("#")) return document.getElementById(sel.slice(1));
    return document.body.querySelectorAll(sel)[0] ?? null;
  },
};

const listeners = new Map();
const listenTo = (target) => {
  target.addEventListener = (type, fn) => {
    const key = `${target === document ? "d" : "w"}:${type}`;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(fn);
  };
  target.removeEventListener = (type, fn) => {
    const fns = listeners.get(`${target === document ? "d" : "w"}:${type}`);
    const i = fns ? fns.indexOf(fn) : -1;
    if (i >= 0) fns.splice(i, 1);
  };
  target.dispatchEvent = (ev) => {
    if (ev.target === undefined) ev.target = target;
    if (ev.stopPropagation === undefined) ev.stopPropagation = () => {};
    if (ev.preventDefault === undefined) ev.preventDefault = () => {};
    for (const fn of [
      ...(listeners.get(`${target === document ? "d" : "w"}:${ev.type}`) ?? []),
    ]) {
      fn(ev);
    }
  };
};

const window = { innerWidth: 1024, innerHeight: 768 };
listenTo(document);
listenTo(window);

globalThis.window = window;
globalThis.document = document;
globalThis.Node = N;
globalThis.DocumentFragment = Frag;
