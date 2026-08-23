// A third service, and the first one that leaves a mark.
//
// Everything else in this example hands data back and forth. This one writes a
// file — which a page cannot do, and is the reason for having a back end that
// is a real process rather than a fiction. The page asks; the file appears on
// the machine the service is running on.
//
// It writes into the temp directory rather than anywhere an application might
// care about: an example that scatters files through someone's project is a
// bad example. The path is returned so the page can say where it went.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** What every `writeHello()` puts in the file. */
const TEXT = "Hello World\n";

export default {
  /**
   * Write "Hello World" to a file, and say where it went.
   *
   * Nothing here knows which host it is answering — no Electrobun, no request,
   * no rpc. It is the module it would be if it were called by a test, which is
   * what makes it the same file under `mosaic web` and `mosaic desktop`. The
   * one difference is whose disk it lands on, and that is the wire's business.
   *
   * @param {string} [name] What to call the file. Its own name only: a path
   *   from a page is a path chosen by whoever is talking to the page.
   * @returns {Promise<{path: string, bytes: number, text: string}>}
   */
  async writeHello(name = "hello.txt") {
    const base = path.basename(String(name)) || "hello.txt";
    if (base.startsWith(".")) {
      const e = new Error("a file name cannot begin with a dot");
      e.data = { field: "name" };
      throw e;
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpcapp-"));
    const file = path.join(dir, base);
    await fs.writeFile(file, TEXT, "utf8");

    const { size } = await fs.stat(file);
    return { path: file, bytes: size, text: TEXT };
  },

  /**
   * Read one back, so the page can show that the file is really there and
   * really says what it was told to say.
   *
   * @param {string} file The path `writeHello()` gave back.
   */
  async read(file) {
    return await fs.readFile(String(file), "utf8");
  },
};
