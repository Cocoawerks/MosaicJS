// Turning text into something an anchor can point at.
//
// A `data:` URL built by hand — `"data:text/plain;charset=utf-8," +
// encodeURIComponent(text)` — works, but has one limit worth caring about: the
// file is the address, so the whole document travels percent-encoded, and
// browsers cap how long an address may be. A document over a few megabytes is a
// download that quietly does not happen.
//
// A blob URL is a handle to the data rather than the data, so there is no cap
// and no encoding pass. Where blobs are not to be had — an old runtime, a test
// shim — the `data:` form still works, and is what this falls back to.

/**
 * A URL an anchor can be pointed at to save `text` as a file.
 *
 * @param {string} text The contents.
 * @param {string} type The MIME type, `charset` included.
 * @returns {string} A `blob:` URL where one can be made, else a `data:` one.
 */
export function encodeText(text, type) {
  if (typeof Blob === "function" && typeof URL?.createObjectURL === "function") {
    return URL.createObjectURL(new Blob([text], { type }));
  }
  return `data:${type},${encodeURIComponent(text)}`;
}
