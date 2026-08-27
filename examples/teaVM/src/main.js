// teaVM — the application bootstrap, and the entry mosaic bundles.
//
// `main.ib.xml` is this module's page, and `shared/units/` is its Java: the
// compiler compiles both, and `import { Units } from "shared"` in the
// controller reaches the compiled Java. The runtime is vendored into the build
// as a package, so it is imported by name.
import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
