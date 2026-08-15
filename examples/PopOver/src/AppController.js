import { setTheme } from "mosaic/frameworks/ui";

export default class AppController {
  constructor() {
    setTheme("aristo");
    this.said = "nothing yet";
  }

  showColours(button) {
    this.colours.show(button);
  }
}
