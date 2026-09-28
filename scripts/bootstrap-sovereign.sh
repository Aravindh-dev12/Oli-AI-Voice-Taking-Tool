#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

[[ "$(uname -s)" == "Darwin" ]] || { echo "Sovereign macOS bootstrap is for macOS." >&2; exit 1; }

npm run build:native:mac
npm run setup:local-llm

cat <<EOF

Oli sovereign runtime is built.

Next:
  1. Set OLI_LLAMA_MODEL_PATH to a licensed Llama 3.2 3B Q4 GGUF file,
     or set OLI_LLAMA_HF_REPO to its Hugging Face GGUF repository.
  2. Run: npm run local:chat
  3. In another terminal run: npm start
  4. Dashboard -> AI settings -> Provider: Local
EOF