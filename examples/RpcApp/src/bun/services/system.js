// A second service, to show that a group is a file: this one answers
// `api.system.*`, and adding it took nothing but writing it.
//
// What it is really here for is the thing this example exists to demonstrate —
// that the same file answers the page whichever way the application is being
// run. Nothing below asks which host it is in except `where()`, and that only
// so the page has something to print.

export default {
  /**
   * Which host is answering.
   *
   * `this.context` is what the host knew about the caller, and it is the one
   * place the two differ: `mosaic web` passes the Request it is answering, and
   * the desktop passes the window the call came from. A service that does not
   * care — every other function in this example — is written as though it were
   * an ordinary module, because it is one.
   */
  async where() {
    if (this.context?.request) {
      return {
        host: "web",
        detail: `${new URL(this.context.request.url).host}, over POST /rpc`,
      };
    }
    if (this.context?.host === "desktop") {
      return { host: "desktop", detail: "the Electrobun main process, over the window's bridge" };
    }
    return { host: "unknown", detail: "no context — a test, most likely" };
  },

  /**
   * What the process running this is. None of it is reachable from a page, and
   * that is the point: this is Bun, on the other side of the wire.
   */
  async about() {
    return {
      bun: Bun.version,
      platform: process.platform,
      pid: process.pid,
      // A page cannot read the disk. This can.
      cwd: process.cwd().split("/").slice(-2).join("/"),
    };
  },

  /**
   * A method that always fails, so the example can show what a failure looks
   * like when it is not the caller's fault.
   */
  async fail() {
    throw new Error("this service always refuses — that is what it is for");
  },
};
