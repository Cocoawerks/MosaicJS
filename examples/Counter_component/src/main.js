// Counter_component — the application bootstrap, and the entry mosaic bundles.
//
// `main.ib` is this module's page: it sits beside this file, so the compiler
// compiles it and puts `Main` in scope here. Nothing imports it by hand.
import { MosaicApplication } from "mosaic";

import AppController from "./src/AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
