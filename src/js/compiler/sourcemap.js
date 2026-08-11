// Emitting a v3 source map beside each compiled module.
//
// Mapping is line-level: each generated line points at the markup or JS line it
// came from, which is all `h()` output needs — devtools then show the original
// `.mib` rather than the generated calls.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Build the map for one module.
 *
 * @param source   original path, as it should be recorded in the map
 * @param content  original source text, inlined so devtools need no fetch
 * @param mappings `[generated line, source line]` pairs, both 1-based
 */
export function forModule(source, content, mappings) {
  const byLine = [...mappings].sort((a, b) => a[0] - b[0]);

  let out = "";
  let currentLine = 1;
  let prevSourceLine = 0;
  let seen = -1;

  for (const [gen, srcLine] of byLine) {
    if (gen === seen) continue; // one segment per generated line
    seen = gen;
    while (currentLine < gen) {
      out += ";";
      currentLine++;
    }
    // Generated column 0 -> source 0, the given line, column 0.
    out += vlq(0) + vlq(0) + vlq(srcLine - 1 - prevSourceLine) + vlq(0) + ";";
    prevSourceLine = srcLine - 1;
    currentLine++;
  }

  return (
    JSON.stringify({
      version: 3,
      sources: [source],
      sourcesContent: [content],
      names: [],
      mappings: out,
    }) + "\n"
  );
}

/** Base64 VLQ, as source maps encode their numbers. */
export function vlq(value) {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 0b11111;
    v >>>= 5;
    if (v > 0) digit |= 0b100000;
    out += ALPHABET[digit];
  } while (v > 0);
  return out;
}
