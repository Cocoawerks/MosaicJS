import { MosaicApplication } from "mosaic";

import AppController from "./AppController.js";

new MosaicApplication({ id: "app", controller: new AppController() });
