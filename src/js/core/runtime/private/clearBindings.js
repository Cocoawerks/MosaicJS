// Dropping a controller's bindings when the nodes holding them go away.
import { BINDINGS } from "./bindings.js";

export function clearBindings(controller) {
  if (
    controller &&
    Object.prototype.hasOwnProperty.call(controller, BINDINGS)
  ) {
    controller[BINDINGS].length = 0;
  }
}
