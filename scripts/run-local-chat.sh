#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${OLI_LLAMA_SERVER_BIN:-$ROOT_DIR/.local/llama-build/bin/llama-server}"
if [[ ! -x "$BIN" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  BIN="$ROOT_DIR/.local/llama-build/Release/bin/llama-server"
fi

[[ -x "$BIN" ]] || {
  echo "llama-server is not built. Run: npm run setup:local-llm" >&2
  exit 1
}

HOST="${OLI_LOCAL_CHAT_HOST:-127.0.0.1}"
PORT="${OLI_LOCAL_CHAT_PORT:-1234}"
ARGS=(--host "$HOST" --port "$PORT")

if [[ -n "${OLI_LLAMA_MODEL_PATH:-}" ]]; then
  [[ -f "$OLI_LLAMA_MODEL_PATH" ]] || { echo "Llama model not found: $OLI_LLAMA_MODEL_PATH" >&2; exit 1; }
  ARGS+=(--model "$OLI_LLAMA_MODEL_PATH")
elif [[ -n "${OLI_LLAMA_HF_REPO:-}" ]]; then
  ARGS+=(-hf "$OLI_LLAMA_HF_REPO")
else
  echo "Set OLI_LLAMA_MODEL_PATH or OLI_LLAMA_HF_REPO before starting llama-server." >&2
  exit 1
fi

echo "[Oli] Starting local Llama server on http://$HOST:$PORT"
exec "$BIN" "${ARGS[@]}"