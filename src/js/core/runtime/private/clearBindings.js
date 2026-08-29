// Dropping an owner's bindings when the nodes holding them go away.
import { resetBindings } from "./bindings.js";

export function clearBindings(owner) {
  if (owner) resetBindings(owner);
}
