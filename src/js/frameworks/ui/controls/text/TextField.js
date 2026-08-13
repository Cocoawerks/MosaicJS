// TextField, ported from GWT Mosaic (client/components/TextField.java + its
// TextField.ui.xml template): a single line of text, in a box that can carry
// an icon at either end.
import TextBase from "./TextBase.js";

/** The kinds of input a field can be, matching TextFieldType.java. */
export const TextFieldType = Object.freeze({
    TEXT: "text",
    EMAIL: "email",
    TEL: "tel",
    PASSWORD: "password",
    SEARCH: "search",
});

export default class TextField extends TextBase {
    static props = {
        /** Which kind of input it is, one of TextFieldType. */
        type: {type: String, default: TextFieldType.TEXT},
        /** Whether the text can be read but not changed. */
        readOnly: {type: Boolean, default: false},
        /** Off by default, as the Java version sets it in its constructor. */
        spellCheck: {type: Boolean, default: false},
    };

    inputExtras() {
        return {
            type: this.type,
            readonly: this.readOnly ? "readonly" : null,
            spellcheck: String(this.spellCheck),
        };
    }
}
