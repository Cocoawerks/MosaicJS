# MosaicJS

A Cocoa-inspired UI framework for JavaScript.

Components are written as markup and compiled to imperative JavaScript that builds
the DOM directly.

Requires [Bun](https://bun.sh).

## Install

```sh
make install        # standalone `mosaic` on your PATH, no bun needed to run it
make install-link   # or: a wrapper pointing at this checkout, for development
make where          # show where it would go, and why
```

## Quickstart

```sh
mosaic init myapp
cd myapp
mosaic web dev      # build, serve, and rebuild on every change
```

## Commands

| Command | Description |
| --- | --- |
| `mosaic init <name>` | Create a new application |
| `mosaic compile [dir]` | Compile and bundle |
| `mosaic compile watch [dir]` | Compile, then rebuild on every change |
| `mosaic web [dev] [dir]` | Compile, serve, and restart on every change |
| `mosaic desktop [dev] [dir]` | The same, run as a native desktop app |
| `mosaic test --script <url> [dir]` | Compile and serve, then drive it in puppeteer |
| `mosaic check [dir]` | Compile, then run the browser test |
| `mosaic clean [dir]` | Delete the app's build directory |

Every command takes an application directory, defaulting to the current one.

`ibc` is the compiler underneath, usable on its own:

```sh
ibc --outdir build src/
```

## Applications

An application is a directory containing an `info.json`:

```json
{
  "app_name": "Counter",
  "version": "0.1.0",
  "theme": "aristo",
  "main_file": "src/main.js",
  "frameworks": ["ui"]
}
```

`main_file` is the bootstrap module. The application's code is the tree that file
sits in — everything beside and below it, nothing above — so `info.json` can live
further up, at the root of a project whose other directories the compiler ignores.

Builds land in `build/` inside the application directory.

## Examples

Sixteen sample applications live in [`examples/`](examples). Each is a complete
application directory — compile and run any of them:

```sh
mosaic web dev examples/Counter_main
```

## Roadmap

**Interface Builder for the web** — a visual editor for laying out Mosaic
interfaces by direct object manipulation in the vein of Apple's Interface
Builder, GNUstep's [Gorm](https://gnustep.github.io/), and 280 North's Atlas
for [Cappuccino](https://www.cappuccino.dev/).

Layouts are already compiled from `.ib.xml` documents, so the format the editor
would write is the one `ibc` reads today.

## Testing

### Unit Tests
```sh
bun test
```

### In the browser

`mosaic test` compiles and serves an application the way `web` does, then drives
it in Chromium through puppeteer:

```sh
mosaic test --script ./tour.js examples/Counter_component
```

The script is an ES module whose default export is an async function
`(page, context) => {…}`. It throws to fail the test and returns to pass.

By default it opens a window and works at a pace you can watch, so a test
doubles as a demo. It can also run headless. 

| Option | Description |
| --- | --- |
| `--script <url>` | The test script: a URL, or a path taken as a file |
| `--headless` | No window and no pausing — a fast run for CI |
| `--speed <ms>` | Pause before each action (default 50) |

`mosaic check` is the smaller one: compile, then run the headless browser test.
