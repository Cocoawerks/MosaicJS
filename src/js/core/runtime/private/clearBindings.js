// Dropping a controller's bindings when the nodes holding them go away.
import { resetBindings } from "./bindings.js";

export function clearBindings(controller) {
  if (controller) resetBindings(controller);
}
