// `{count}` in markup compiles to a call to this.

/**
 * Declare a `{path}` text binding. The compiler emits this for `{count}`; the
 * value is read from the controller during render, and again on `refresh`.
 */
export function bindText(controller, path) {
    return {__ibBind: "text", controller, path};
}
