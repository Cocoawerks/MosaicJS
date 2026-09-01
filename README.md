# MosaicJS

A Cocoa-inspired UI framework for JavaScript, with its own compiler and build tool.

Components are written as markup and compiled to imperative JavaScript that builds
the DOM directly — no virtual DOM, no runtime template parsing. Applications run in
the browser or as a native desktop app.

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

Builds land in `build/` inside the application directory, which makes that
directory the whole of the deployable thing.

Bundling is Bun's: it walks the import graph from the bootstrap, so the payload
holds only what the entry actually reaches.

## Examples

Sixteen sample applications live in [`examples/`](examples). Each is a complete
application directory — compile and run any of them:

```sh
mosaic web dev examples/Counter_main
```

## Roadmap

**Interface Builder for the web** — a visual editor for laying out Mosaic
interfaces by direct manipulation, in the spirit of Apple's Interface Builder and
GNUstep's [Gorm](https://gnustep.github.io/). Layouts are already compiled from
`.ib.xml` documents, so the format the editor would write is the one `ibc` reads
today.

## Tests

```sh
bun test
```
