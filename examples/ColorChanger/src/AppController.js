
export default class AppController {
  constructor() {
      this.color = "#ff0000";
  }


  swap() {
    this.color = this.color === "#000" ? "#ff0000" : "#000";
  }
}
