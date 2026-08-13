// The page's controller. In this version it has almost nothing to do: the
// counter owns its own state, so all the page binds is {title}.
//
// Compare Counter_main/AppController.js, which drives every part of the counter
// itself.
export default class AppController {
    constructor({title = "Counter App"} = {}) {
        this.title = title;
    }
}
