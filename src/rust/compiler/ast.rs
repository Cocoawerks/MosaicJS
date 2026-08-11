//! AST for a single component file.
//!
//! Markup carries no logic: no conditionals, no loops, no JavaScript. The only
//! dynamic piece is `{path}`, which reads a property from the controller.
//! Everything else is reached through `ib:outlet` and driven by a controller.

#[derive(Debug, Clone)]
pub enum AttrValue {
    /// `disabled` — boolean attribute with no value.
    Empty,
    /// `class="box"` — a literal string.
    Static(String),
    /// `class="item {status}"` — literals interleaved with controller paths.
    Template(Vec<StrPart>),
}

#[derive(Debug, Clone)]
pub enum StrPart {
    Text(String),
    /// A dotted path read from the controller, e.g. `count` or `user.name`.
    Bind(String),
}

#[derive(Debug, Clone)]
pub struct Attr {
    pub name: String,
    pub value: AttrValue,
}

/// One entry from `ib:action`. `event` is `None` for a bare method name, which
/// means "click" on a DOM element and "the component's action" on a component.
#[derive(Debug, Clone)]
pub struct Action {
    pub event: Option<String>,
    pub method: String,
}

#[derive(Debug, Clone)]
pub enum Node {
    Text(String),
    /// `{count}` — a text node bound to `this.count` on the controller.
    /// Carries the source line, for source maps.
    Bind(String, usize),
    Element {
        /// Source line of the opening tag, for source maps.
        line: usize,
        name: String,
        attrs: Vec<Attr>,
        /// `ib:outlet="name"` — binds the DOM node to `this.name`.
        outlet: Option<String>,
        /// `ib:action="click:method"` — binds listeners to controller methods.
        actions: Vec<Action>,
        children: Vec<Node>,
    },
}

#[derive(Debug, Default)]
pub struct Component {
    /// Contents of the top-level `<style>` block (unscoped source).
    pub style: String,
    pub markup: Vec<Node>,
}
