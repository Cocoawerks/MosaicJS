// Reading a `<meta name="…">` the host page carries.
//
// A server-rendered page often hands the app a few values up front — the CSRF
// token, who is signed in — in meta tags rather than through a first request.
// `meta("user-email")` reads one, or the empty string when it is not there.

/** @public **/
export function meta(name) {
  if (typeof document === "undefined") return "";
  return document.querySelector(`meta[name="${name}"]`)?.content ?? "";
}
