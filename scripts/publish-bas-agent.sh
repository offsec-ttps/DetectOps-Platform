#!/usr/bin/env bash
# Build the BAS agent (release) and publish it to the control-plane artifacts dir
# so endpoints can download it over HTTP (instead of building from source).
#
#   bas-agent/dist/bas_agent-<os>-<arch>[.exe]   ← served by /api/v1/agent/download
#   bas-agent/dist/bas_agent-<os>-<arch>.sha256  ← integrity sidecar
#
# Usage:
#   scripts/publish-bas-agent.sh                       # build + publish for THIS host
#   scripts/publish-bas-agent.sh --os windows          # CROSS-compile Windows (needs the
#                                                      #   x86_64-pc-windows-gnu target + mingw-w64)
#   scripts/publish-bas-agent.sh --os macos --bin path # publish an already-built macOS binary
set -euo pipefail
cd "$(dirname "$0")/.."

OS=""; ARCH="$(uname -m)"; SRC=""
while [ $# -gt 0 ]; do case "$1" in
  --os) OS="$2"; shift 2;; --arch) ARCH="$2"; shift 2;; --bin) SRC="$2"; shift 2;;
  *) echo "unknown arg $1"; exit 1;; esac; done

# Default OS from the host.
if [ -z "$OS" ]; then
  case "$(uname -s)" in Linux) OS=linux;; Darwin) OS=macos;; *) OS=linux;; esac
fi

DIST="bas-agent/dist"
mkdir -p "$DIST"

# Build (or cross-build) for this host if no prebuilt binary was supplied.
if [ -z "$SRC" ]; then
  HOST_OS=linux; case "$(uname -s)" in Darwin) HOST_OS=macos;; esac
  if [ "$OS" = "windows" ] && [ "$HOST_OS" != "windows" ]; then
    # Cross-compile for Windows via the gnu target + mingw-w64 linker.
    command -v x86_64-w64-mingw32-gcc >/dev/null || { echo "need mingw-w64 (x86_64-w64-mingw32-gcc) to cross-build Windows"; exit 1; }
    rustup target list --installed | grep -q x86_64-pc-windows-gnu || rustup target add x86_64-pc-windows-gnu
    echo "cross-compiling for x86_64-pc-windows-gnu…"
    export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
    export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
    ( cd bas-agent && cargo build --release --target x86_64-pc-windows-gnu )
    SRC="bas-agent/target/x86_64-pc-windows-gnu/release/bas_agent.exe"
  elif [ "$OS" = "$HOST_OS" ]; then
    echo "building release for this host…"
    ( cd bas-agent && cargo build --release )
    SRC="bas-agent/target/release/bas_agent"
  else
    echo "cannot build $OS from a $HOST_OS host without a cross toolchain — pass --bin <prebuilt>"; exit 1
  fi
fi
[ -f "$SRC" ] || { echo "binary not found: $SRC"; exit 1; }

EXT=""; [ "$OS" = "windows" ] && EXT=".exe"
OUT="$DIST/bas_agent-${OS}-${ARCH}${EXT}"
install -m 0755 "$SRC" "$OUT"
( cd "$DIST" && sha256sum "$(basename "$OUT")" | awk '{print $1}' > "$(basename "$OUT").sha256" )
echo "published $OUT"
echo "  sha256 $(cat "$OUT.sha256")"
