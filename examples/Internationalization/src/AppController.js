// The page's controller.
//
// Almost nothing here is about language. The markup says `{MESSAGES.…}` and the
// runtime looks each one up, so the only i18n in this file is `setLocale` and
// the two lines that use `MESSAGES.format` — which is for the messages markup
// cannot state, the ones with a value in the middle of them.
import { MESSAGES, setLocale } from "mosaic";

/** What each locale calls itself, for the line saying which is being read. */
const ENDONYMS = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  ru: "Русский",
};

export default class AppController {
  constructor() {
    /** What was typed in the name field. */
    this.name = "";

    /** Which line the page shows above the form, and below the buttons. */
    this.reading = "";
    this.greeting = "";
    this.status = "";
  }

  attached() {
    this.retitle();
  }

  // --- the language ------------------------------------------------------

  /**
   * One method per language rather than one taking an argument, because
   * `action="choose"` calls a method and has no way to pass it anything —
   * markup states what happens, not how.
   */
  chooseEnglish() {
    this.speak("en");
  }

  chooseFrench() {
    this.speak("fr");
  }

  chooseSpanish() {
    this.speak("es");
  }

  chooseGerman() {
    this.speak("de");
  }

  chooseRussian() {
    this.speak("ru");
  }

  /**
   * Read the page in `locale` from here on.
   *
   * `setLocale` is the whole of it: every `{MESSAGES.…}` in the document is
   * written again where it stands, and every component that drew a string of
   * its own is drawn again. Nothing is remounted and no state is touched —
   * which is why the name in the field survives this, and the checkbox stays
   * as it was put.
   *
   * The two lines below are this controller's own: they are messages with
   * something in the middle of them, so they are worked out here rather than
   * bound to, and this is where they are worked out again.
   */
  speak(locale) {
    setLocale(locale);
    this.retitle();
  }

  // --- the messages this page has to work out itself ---------------------

  /**
   * The lines the markup cannot state.
   *
   * A `{binding}` names a value; it does not call a function. So a message
   * with a name or a count in it is `MESSAGES.format(key, params)` here, and
   * the markup binds to the result as it would to any other property.
   */
  retitle() {
    this.reading = MESSAGES.format("Reading in {language}.", {
      language: ENDONYMS[MESSAGES.locale],
    });

    this.greeting = this.name
      ? MESSAGES.format("Hello, {name}.", { name: this.name })
      : MESSAGES.get("Nobody has said who they are yet.");

    // `status` is left as it is: it says what the last button did, and it was
    // said in whatever language was being read at the time. Translating it
    // after the fact would be inventing a sentence nobody caused.
  }

  // --- the form ----------------------------------------------------------

  /** Every keystroke in the name field. */
  typed() {
    this.name = this.nameField.value;
    this.retitle();
  }

  save() {
    this.status = MESSAGES.format("Saved as {name}.", {
      name: this.name || MESSAGES.get("nobody"),
    });
  }

  reset() {
    this.nameField.value = "";
    this.searchField.value = "";
    this.updates.value = false;
    this.name = "";
    this.status = MESSAGES.get("Everything was put back.");
    this.retitle();
  }
}
