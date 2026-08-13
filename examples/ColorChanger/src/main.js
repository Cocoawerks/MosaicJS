// ColorChanger — the application bootstrap, and the entry mosaic bundles.
//
// `main.mib` is this module's page: it sits beside this file, so the compiler
// compiles it and registers it as the application's page — there is nothing to
// import and nothing to name. The runtime is vendored into the build as a
// package, so it is imported by name.
import {MosaicApplication} from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({id: "app", controller: new AppController()});
