package auth;

import java.util.regex.Pattern;

import org.teavm.jso.JSExport;

// PasswordValidator — the rules a password has to meet, in Java. This is the
// kind of thing that has to agree on both sides: the browser checks it as the
// user types so the form can guide them, and the server checks it again because
// the browser cannot be trusted. Written once here, both run the same rules.
//
// Each rule is a regular expression, and each is its own `@JSExport` method
// returning a boolean, so the page can tick them off one at a time as they come
// true. The patterns compile once and are reused.
public class PasswordValidator {

    /** At least eight of anything. */
    private static final Pattern MIN_LENGTH = Pattern.compile(".{8,}");
    /** A capital letter, somewhere. */
    private static final Pattern UPPER_CASE = Pattern.compile("[A-Z]");
    /** A digit, somewhere. */
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    /** A special symbol: anything that is not a letter, a digit or whitespace. */
    private static final Pattern SPECIAL = Pattern.compile("[^A-Za-z0-9\\s]");

    /** At least eight characters. */
    @JSExport
    public static boolean hasMinLength(String password) {
        return matches(MIN_LENGTH, password);
    }

    /** At least one capital letter. */
    @JSExport
    public static boolean hasUpperCase(String password) {
        return matches(UPPER_CASE, password);
    }

    /** At least one digit. */
    @JSExport
    public static boolean hasDigit(String password) {
        return matches(DIGIT, password);
    }

    /** At least one special symbol. */
    @JSExport
    public static boolean hasSpecial(String password) {
        return matches(SPECIAL, password);
    }

    /** Whether the pattern is found anywhere in a password that is there at all. */
    private static boolean matches(Pattern pattern, String password) {
        return password != null && pattern.matcher(password).find();
    }
}
