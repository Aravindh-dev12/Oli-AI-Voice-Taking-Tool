#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${OLI_LLAMA_CPP_SOURCE:-$ROOT_DIR/.local/llama.cpp}"
BUILD_DIR="${OLI_LLAMA_CPP_BUILD:-$ROOT_DIR/.local/llama-build}"
REF="${OLI_LLAMA_CPP_REF:-v0.4.1}"
REPO="${OLI_LLAMA_CPP_REPO:-https://github.com/ggml-org/llama.cpp.git}"

command -v git >/dev/null || { echo "git is required." >&2; exit 1; }
command -v cmake >/dev/null || { echo "cmake is required." >&2; exit 1; }

mkdir -p "$ROOT_DIR/.local"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  echo "[Oli] Cloning llama.cpp ($REF)…"
  git clone --depth 1 --branch "$REF" "$REPO" "$SOURCE_DIR"
else
  echo "[Oli] Updating llama.cpp ($REF)…"
  git -C "$SOURCE_DIR" fetch --depth 1 origin "$REF"
  git -C "$SOURCE_DIR" checkout -q FETCH_HEAD
fi

CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release)
if [[ "$(uname -s)" == "Darwin" ]]; then
  CMAKE_ARGS+=(-DGGML_METAL=ON)
fi

echo "[Oli] Configuring llama-server…"
cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" "${CMAKE_ARGS[@]}"

echo "[Oli] Building llama-server…"
cmake --build "$BUILD_DIR" --config Release -j "${OLI_LLAMA_BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}" --target llama-server

BIN="$BUILD_DIR/bin/llama-server"
if [[ "$(uname -s)" == "Darwin" ]] && [[ ! -x "$BIN" ]]; then
  BIN="$BUILD_DIR/Release/bin/llama-server"
fi

[[ -x "$BIN" ]] || { echo "llama-server build completed but binary was not found: $BIN" >&2; exit 1; }

echo
echo "[Oli] llama-server ready: $BIN"
echo
echo "Set one of:"
echo "  export OLI_LLAMA_MODEL_PATH=/absolute/path/to/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
echo "  export OLI_LLAMA_HF_REPO=<Hugging-Face-GGUF-repository-containing-your-licensed-Q4-model>"
echo
echo "Then run: npm run local:chat"