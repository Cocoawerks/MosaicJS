# Installer for the mosaic CLI.
#
#   make install          install a standalone `mosaic` (no bun needed to run it)
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

.PHONY: install install-link uninstall where check-bun

## Build a self-contained executable and install it. Bun is needed to build,
## not to run: the result embeds its own runtime, so it works anywhere.
install: check-bun
	@mkdir -p "$(DESTDIR)$(BINDIR)"
	@bun build --compile $(ENTRY) --outfile "$(TARGET)" >/dev/null
	@chmod 755 "$(TARGET)"
	@echo "installed $(NAME) -> $(TARGET)"
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

## Explain the choice without touching anything.
where:
	@echo "would install to: $(TARGET)"
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
