package units;

import org.teavm.jso.JSExport;

// Units — the one piece of this application written in Java rather than
// JavaScript. The `shared` directory in info.json points here, and mosaic
// compiles it to JavaScript with TeaVM and folds it into the bundle. The page
// calls it as if it were any other module, imported by this class's Java
// package: `import { Units } from "units"`.
//
// The point is that this is the same code a JVM server would run. A conversion,
// a validation, a rule the two sides have to agree about — write it once here,
// and the browser and the server carry the same one rather than two that drift.
public class Units {

    /** Square feet in a square metre; the exact conversion, not a rounded one. */
    private static final double SQUARE_METRES_PER_SQUARE_FOOT = 0.09290304;

    /**
     * Convert an area in square feet to square metres.
     *
     * `@JSExport` is what carries it across into JavaScript: the method becomes
     * a function on the module the page imports. A `double` on either side is a
     * JavaScript number, so the page passes and reads ordinary numbers.
     */
    @JSExport
    public static double squareFeetToSquareMetres(double squareFeet) {
        return squareFeet * SQUARE_METRES_PER_SQUARE_FOOT;
    }
}
