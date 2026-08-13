// Minimal DOM good enough to exercise the runtime under plain node.
// Not a browser: it implements only what mosaic.js touches.

class N {
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

class Text extends N {
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
  get outerHTML() {
    return `<!--${this.data}-->`;
  }
  get textContent() {
    return "";
  }
}

class Frag extends N {}

const VOID = new Set(["br", "img", "input", "hr", "meta", "link"]);

/**
 * Elements that hold a value as a property rather than as an attribute.
 * `<option>` is not one: its value reflects the attribute, in a browser too.
 */
const VALUE_ELEMENTS = new Set(["input", "select", "textarea"]);

class Element extends N {
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
  dispatchEvent(ev) {
    // Events bubble, as they do in a browser: a control listens on the element
    // it drew, and what the user works may be a node inside it. `bubbles:
    // false` opts out, for the handful of events that do not.
    if (ev.target === undefined) ev.target = this;
    for (let node = this; node; node = node.parentNode) {
      for (const fn of node.listeners?.get(ev.type) ?? []) fn(ev);
      if (ev.bubbles === false) break;
    }
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
    const attrs = [...this.attributes]
      .map(([k, v]) => ` ${k}="${v}"`)
      .join("");
    if (VOID.has(this.tagName)) return `<${this.tagName}${attrs}>`;
    return `<${this.tagName}${attrs}>${this.innerHTML}</${this.tagName}>`;
  }
}

/** Supports only `tag` and `tag[attr]` selectors — all the tests need. */
function matches(el, sel) {
  const m = /^([a-z0-9-]+)?(?:\[([^\]=]+)\])?$/i.exec(sel.trim());
  if (!m) return false;
  const [, tag, attr] = m;
  if (tag && el.tagName !== tag) return false;
  if (attr && !el.attributes.has(attr)) return false;
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

globalThis.document = document;
globalThis.Node = N;
globalThis.DocumentFragment = Frag;
