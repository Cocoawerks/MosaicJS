/**
 * Splitter — the application bootstrap, and the entry mosaic bundles.
 *
 * `main.ib.xml` is this module's page: it sits beside this file, so the compiler
 * compiles it and registers it as the application's page. Nothing imports it
 * by hand.
 */
import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
