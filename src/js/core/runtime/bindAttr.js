// `styleName="value {status}"` compiles to a call to this.

/**
 * Declare an attribute value built from literals and `{path}` bindings, e.g.
 * `class="item {status}"`.
 */
export function bindAttr(controller, parts) {
    return {__ibBind: "attr", controller, parts};
}
