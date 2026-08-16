// OutlineView and OutlineItem, ported from GWT Mosaic.
// Build first: `mosaic compile examples/Counter_component --keep-modules` — these
// tests import the compiled modules themselves, which a plain compile prunes
// once they are in the bundle.
import assert from "node:assert/strict";
import test from "node:test";
import "./dom-shim.mjs";

const { mount, h } =
  await import("../examples/Counter_component/build/node_modules/mosaic/runtime/mosaic.js");
const { OutlineItem, OutlineView } =
  await import("../examples/Counter_component/build/node_modules/mosaic/frameworks/ui/index.js");

/** A row, with its own rows nested inside it the way markup does. */
const item = (props, ...children) => h(OutlineItem, props, ...children);

/**
 * The tree the tests work:
 *
 *   Mail            mail
 *     Inbox         inbox
 *       Work        work
 *     Sent          sent
 *   Files           files
 */
const tree = () => [
  item(
    { text: "Mail", value: "mail" },
    item(
      { text: "Inbox", value: "inbox" },
      item({ text: "Work", value: "work" }),
    ),
    item({ text: "Sent", value: "sent" }),
  ),
  item({ text: "Files", value: "files" }),
];

/** Mount a view and hand back what a test needs to work it. */
function open(props = {}, children = tree()) {
  const host = document.createElement("div");
  const view = mount(OutlineView, host, { ...props, children }).view;
  return { host, view, el: host.childNodes[0] };
}

const classesOf = (el) =>
  el.getAttribute("class").split(" ").filter(Boolean).slice(0, -1);

/** Every row on screen, top to bottom — a shut row's own rows are not drawn. */
const rows = (el) => el.querySelectorAll("li[role]");

/** The rows a reader can actually see, by what they read. */
const visible = (el) =>
  rows(el)
    .filter((li) => {
      for (let n = li.parentNode; n; n = n.parentNode) {
        if (n.getAttribute?.("class")?.includes("collapse")) {
          const owner = n.parentNode;
          if (
            owner?.getAttribute?.("role") === "treeitem" &&
            !classesOf(owner).includes("expanded")
          ) {
            return false;
          }
        }
      }
      return true;
    })
    .map((li) => labelOf(li));

const contentOf = (li) => li.childNodes[0];
const toggleOf = (li) => contentOf(li).childNodes[0];
const labelOf = (li) => contentOf(li).childNodes[2].textContent;
const rowNamed = (el, text) => rows(el).find((li) => labelOf(li) === text);

const click = (el) => el.dispatchEvent({ type: "click" });
const keyDown = (el, key) => {
  let prevented = false;
  el.dispatchEvent({
    type: "keydown",
    key,
    preventDefault: () => (prevented = true),
  });
  return prevented;
};

// --- what it draws -----------------------------------------------------------

test("draws the ported markup: div[role=tree] over li[role=treeitem]", () => {
  const { el } = open();

  assert.equal(el.tagName, "div");
  assert.equal(el.getAttribute("role"), "tree");
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.deepEqual(classesOf(el), ["v-OutlineView"]);

  const list = el.childNodes[0].childNodes[0];
  assert.equal(list.tagName, "ul");
  assert.deepEqual(classesOf(list), ["v-Outline-list"]);

  const mail = rowNamed(el, "Mail");
  assert.equal(mail.tagName, "li");
  assert.equal(mail.getAttribute("role"), "treeitem");
  assert.deepEqual(classesOf(contentOf(mail)), ["content", "level-0"]);
});

test("a row states how deep it sits, which is what the sheet indents by", () => {
  const { el } = open({}, tree());

  assert.deepEqual(classesOf(contentOf(rowNamed(el, "Mail"))), [
    "content",
    "level-0",
  ]);
  assert.deepEqual(classesOf(contentOf(rowNamed(el, "Inbox"))), [
    "content",
    "level-1",
  ]);
  assert.deepEqual(classesOf(contentOf(rowNamed(el, "Work"))), [
    "content",
    "level-2",
  ]);
});

test("only a row with something under it is expandable", () => {
  const { el } = open();

  assert.ok(classesOf(rowNamed(el, "Mail")).includes("expandable"));
  assert.equal(classesOf(rowNamed(el, "Files")).includes("expandable"), false);

  // And only an expandable row offers its chevron to a reader.
  assert.equal(
    toggleOf(rowNamed(el, "Mail")).getAttribute("aria-hidden"),
    null,
  );
  assert.equal(
    toggleOf(rowNamed(el, "Files")).getAttribute("aria-hidden"),
    "true",
  );
});

test("an icon is drawn from a class name or from a component", () => {
  const Svg = () => h("svg", {});
  const { el } = open({}, [
    item({ text: "Font", value: "font", icon: "fa-inbox" }),
    item({ text: "Svg", value: "svg", icon: Svg }),
  ]);

  const iconOf = (name) => contentOf(rowNamed(el, name)).childNodes[1];
  assert.deepEqual(classesOf(iconOf("Font")), ["icon", "fa-inbox"]);
  assert.equal(iconOf("Svg").childNodes[0].tagName, "svg");
});

// --- what it discloses -------------------------------------------------------

test("everything starts shut, and the markup may say otherwise", () => {
  assert.deepEqual(visible(open().el), ["Mail", "Files"]);

  const { el } = open({}, [
    item(
      { text: "Mail", value: "mail", expanded: "true" },
      item({ text: "Inbox", value: "inbox" }),
    ),
  ]);
  assert.deepEqual(visible(el), ["Mail", "Inbox"]);
});

test("clicking the chevron opens a row, and clicking it again shuts it", () => {
  const { el, view } = open();

  click(toggleOf(rowNamed(el, "Mail")));
  assert.ok(view.isExpanded("mail"));
  assert.deepEqual(visible(el), ["Mail", "Inbox", "Sent", "Files"]);

  click(toggleOf(rowNamed(el, "Mail")));
  assert.equal(view.isExpanded("mail"), false);
  assert.deepEqual(visible(el), ["Mail", "Files"]);
});

test("and does not select the row it opened", () => {
  const { el, view } = open();

  click(toggleOf(rowNamed(el, "Mail")));
  assert.equal(view.value, "");
});

test("expandAll opens every row that has one, collapseAll shuts them", () => {
  const { el, view } = open();

  view.expandAll();
  assert.deepEqual(visible(el), ["Mail", "Inbox", "Work", "Sent", "Files"]);

  view.collapseAll();
  assert.deepEqual(visible(el), ["Mail", "Files"]);
});

// --- what it selects ---------------------------------------------------------

test("clicking a row selects it, and only it", () => {
  const { el, view } = open();
  view.expandAll();

  click(rowNamed(el, "Sent"));
  assert.equal(view.value, "sent");
  assert.ok(classesOf(rowNamed(el, "Sent")).includes("selected"));
  assert.equal(rowNamed(el, "Sent").getAttribute("aria-selected"), "true");

  click(rowNamed(el, "Files"));
  assert.equal(view.value, "files");
  assert.equal(classesOf(rowNamed(el, "Sent")).includes("selected"), false);
});

test("a click on a nested row is not a click on the rows above it", () => {
  const { el, view } = open();
  view.expandAll();

  click(rowNamed(el, "Work"));
  assert.equal(view.value, "work");
});

test("selecting fires the action; assigning to value does not", () => {
  const fired = [];
  const { el, view } = open({ action: (control, value) => fired.push(value) });
  view.expandAll();

  click(rowNamed(el, "Inbox"));
  assert.deepEqual(fired, ["inbox"]);

  view.value = "sent";
  assert.equal(view.value, "sent");
  assert.deepEqual(fired, ["inbox"]);
});

test("the markup may say which row starts selected", () => {
  const { el, view } = open({}, [
    item({ text: "Mail", value: "mail" }),
    item({ text: "Files", value: "files", selected: "true" }),
  ]);

  assert.equal(view.value, "files");
  assert.ok(classesOf(rowNamed(el, "Files")).includes("selected"));
});

test("the selected row is reported as the markup stated it", () => {
  const { view } = open({ value: "mail" });

  assert.equal(view.selectedItem.text, "Mail");
  assert.equal(view.selectedItem.level, 0);
});

// --- the keyboard ------------------------------------------------------------

test("the arrows move through what can be seen, and stop at the ends", () => {
  const { el, view } = open({ value: "mail" });

  // Shut, so what is below Mail is Files and not Inbox.
  assert.ok(keyDown(el, "ArrowDown"));
  assert.equal(view.value, "files");

  keyDown(el, "ArrowDown");
  assert.equal(view.value, "files");

  keyDown(el, "ArrowUp");
  assert.equal(view.value, "mail");

  keyDown(el, "ArrowUp");
  assert.equal(view.value, "mail");
});

test("and step into a row once it is open", () => {
  const { el, view } = open({ value: "mail" });
  view.setExpanded("mail", true);

  keyDown(el, "ArrowDown");
  assert.equal(view.value, "inbox");
});

test("the space bar opens the selected row and shuts it again", () => {
  const { el, view } = open({ value: "mail" });

  assert.ok(keyDown(el, " "));
  assert.ok(view.isExpanded("mail"));

  keyDown(el, " ");
  assert.equal(view.isExpanded("mail"), false);
});

test("a row with nothing under it has nothing to open", () => {
  const { el, view } = open({ value: "files" });

  keyDown(el, " ");
  assert.equal(view.isExpanded("files"), false);
});

test("the tree itself is the tab stop, not any row in it", () => {
  const { el } = open();

  // A tree is a Component and not a Control: it has no enabled state, and the
  // one tab stop is the tree, as OutlineView.ui.xml states it.
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.equal(el.getAttribute("aria-disabled"), null);
  for (const li of rows(el)) assert.equal(li.getAttribute("tabindex"), null);
});
