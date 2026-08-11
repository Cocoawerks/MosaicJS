# Installer for the mosaic CLI.
#
#   make install          install a standalone `mosaic` (no bun needed to run it)
#                         plus its runtime and frameworks, into $(LIBDIR)
#   make install-link     install a wrapper pointing at this checkout, for development
#   make uninstall        remove whichever one is installed
#   make where            show where it would go, and why
#
# The install location is picked for you: the least restrictive directory on
# your PATH — one you can write to without sudo. Override it with
# `make install BINDIR=/somewhere/else`, or set PREFIX for a `$(PREFIX)/bin`
# layout. `make install DESTDIR=/staging` stages into a package root.

SHELL := /bin/sh
NAME  := mosaic
ENTRY := bin/mosaic.js
ROOT  := $(abspath $(dir $(firstword $(MAKEFILE_LIST))))

# Where the CLI goes. Resolution order:
#   1. BINDIR, if you set it
#   2. $(PREFIX)/bin, if you set PREFIX
#   3. the first directory on PATH we can write to, preferring the conventional
#      user ones — no sudo, no shell config to edit
#   4. ~/.local/bin, created if need be: it is on PATH by default on any
#      systemd distro, and the spec location for user binaries
#
# A directory is only chosen if it is already writable, so a plain `make install`
# never needs sudo — that is what "least restrictive" buys you. Root-owned
# directories like /usr/local/bin are reachable only by naming them:
#
#   sudo make install BINDIR=/usr/local/bin
ifdef PREFIX
BINDIR ?= $(PREFIX)/bin
endif

# `case` is avoided below: make counts parentheses inside $(shell ...), and a
# `*)` pattern would close the call early.
BINDIR ?= $(shell \
	writable() { [ -d "$$1" ] && [ -w "$$1" ]; }; \
	onpath() { printf '%s' ":$$PATH:" | grep -qF ":$$1:"; }; \
	for dir in "$$HOME/.local/bin" "$$HOME/bin"; do \
		if onpath "$$dir" && writable "$$dir"; then echo "$$dir"; exit 0; fi; \
	done; \
	IFS=:; for dir in $$PATH; do \
		[ -n "$$dir" ] || continue; \
		expr "$$dir" : "$$HOME/" >/dev/null || continue; \
		if printf '%s' "$$dir" | grep -q '/mise/'; then continue; fi; \
		if writable "$$dir"; then echo "$$dir"; exit 0; fi; \
	done; \
	IFS=:; for dir in $$PATH; do \
		[ -n "$$dir" ] || continue; \
		if writable "$$dir"; then echo "$$dir"; exit 0; fi; \
	done; \
	echo "$$HOME/.local/bin")

TARGET := $(DESTDIR)$(BINDIR)/$(NAME)

# Where mosaic's own trees go — the runtime and the frameworks it copies into
# every build. They are data, not code: the executable cannot hold them, so
# they are installed beside it and the binary is told where they are.
#
# `$(BINDIR)/../lib/mosaic`, which is the conventional place for both layouts
# it lands in: ~/.local/bin -> ~/.local/lib/mosaic, /usr/local/bin ->
# /usr/local/lib/mosaic. DESTDIR stages it; the path baked in is the one it
# will be read from.
LIBDIR  ?= $(abspath $(BINDIR)/../lib/$(NAME))
LIBROOT := $(DESTDIR)$(LIBDIR)
# What is copied there: the runtime and compiler, the frameworks, and the page
# `check` opens when an application does not name one of its own.
LIBTREES := src/js/core src/js/frameworks test/browser-check.html

.PHONY: install install-link uninstall where check-bun

## Build a standalone executable and install it, with mosaic's own runtime and
## frameworks beside it in $(LIBDIR). Bun is needed to build, not to run.
install: check-bun
	@mkdir -p "$(DESTDIR)$(BINDIR)"
	@bun build --compile $(ENTRY) --outfile "$(TARGET)" \
		--define MOSAIC_INSTALLED_HOME='"$(LIBDIR)"' >/dev/null
	@chmod 755 "$(TARGET)"
	@rm -rf "$(LIBROOT)"
	@for tree in $(LIBTREES); do \
		mkdir -p "$(LIBROOT)/$$(dirname $$tree)"; \
		cp -R "$(ROOT)/$$tree" "$(LIBROOT)/$$tree"; \
	done
	@echo "installed $(NAME) -> $(TARGET)"
	@echo "           runtime -> $(LIBROOT)"
	@$(MAKE) --no-print-directory path-note

## Install a wrapper that runs this checkout, so edits take effect immediately.
## Needs bun on PATH at run time, and breaks if this directory moves.
install-link: check-bun
	@mkdir -p "$(DESTDIR)$(BINDIR)"
	@printf '#!/bin/sh\n# mosaic — development install, runs %s\nexec bun "%s/%s" "$$@"\n' \
		"$(ROOT)" "$(ROOT)" "$(ENTRY)" > "$(TARGET)"
	@chmod 755 "$(TARGET)"
	@echo "linked $(NAME) -> $(TARGET) (runs $(ROOT)/$(ENTRY))"
	@$(MAKE) --no-print-directory path-note

uninstall:
	@if [ -e "$(TARGET)" ]; then rm -f "$(TARGET)"; echo "removed $(TARGET)"; \
	else echo "nothing installed at $(TARGET)"; fi
	@if [ -d "$(LIBROOT)" ]; then rm -rf "$(LIBROOT)"; echo "removed $(LIBROOT)"; fi

## Explain the choice without touching anything.
where:
	@echo "would install to: $(TARGET)"
	@echo "         runtime: $(LIBROOT)"
	@if [ -d "$(BINDIR)" ] && [ -w "$(BINDIR)" ]; then echo "  writable:  yes"; \
	elif [ -d "$(BINDIR)" ]; then echo "  writable:  NO — needs sudo, or set BINDIR"; \
	else echo "  writable:  directory does not exist yet, will be created"; fi
	@case ":$$PATH:" in *":$(BINDIR):"*) echo "  on PATH:   yes" ;; \
		*) echo "  on PATH:   no" ;; esac

check-bun:
	@command -v bun >/dev/null || { \
		echo "mosaic: bun is required to build the CLI — https://bun.sh" >&2; exit 1; }

# Installing somewhere off PATH is not an error, but it is not useful in
# silence either.
.PHONY: path-note
path-note:
	@case ":$$PATH:" in *":$(BINDIR):"*) ;; \
		*) echo ""; \
		   echo "note: $(BINDIR) is not on your PATH. Add it with:"; \
		   echo "  export PATH=\"$(BINDIR):\$$PATH\"" ;; esac
