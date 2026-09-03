// Splitter — the native side, and what `mosaic desktop` runs as the main
// process. This directory is `bun/` by convention: the compiler skips it,
// because none of it is browser code and none of it belongs in the page bundle.
//
// It runs in Bun, not in the page. There is no DOM here — what it does is open
// the window the page is drawn in, and whatever else has to be asked of the
// operating system: menus, a tray, dialogs, the file system.
//
// This file is yours. It was written once by `mosaic init desktop` and is
// never regenerated; change the window, add more of them, do what you like.
//
// `mosaic/desktop` is Electrobun's own API with one thing already done: a
// window made from it can answer the page's calls to this application's
// services. Everything Electrobun exports is re-exported, so a tray or a menu
// is imported from here too — or from `electrobun/bun` directly, for a
// window deliberately wired to nothing.
//
// Two things are not free to change. The page lives at
// `views://mainview/index.html` — that is the view `desktop` generates —
// and this file is `index.js`, which is the name Electrobun's launcher
// runs.
//
// Keep this directory self-contained. It is copied into the generated project
// whole, so a relative import reaching up out of it would not survive the move.
import { BrowserWindow } from "mosaic/desktop";

new BrowserWindow({
  title: "Splitter",
  url: "views://mainview/index.html",
  frame: { width: 1024, height: 768, x: 200, y: 200 },
});
