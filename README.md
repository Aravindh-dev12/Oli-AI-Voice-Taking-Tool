# Oli — sovereign notch meeting copilot

Oli is a tray-resident desktop meeting copilot designed around a black notch-style HUD: ambient when quiet, a short whisper flare for important live cues, and a command shelf for live transcript, battlecards, MEDDPICC intelligence, and commitments.

## What is implemented

- **Ambient notch HUD:** black pill, 40 px-class whisper flare, and command shelf states.
- **Protected overlay:** Electron content protection is enabled for the overlay. On newer macOS ScreenCaptureKit capture paths, this remains best-effort and must be validated on the target conferencing client/OS.
- **Native macOS capture:** ScreenCaptureKit captures system audio and microphone as separate channels with no screen frames persisted.
- **Cross-platform fallback capture:** Chromium microphone + tab/system audio capture remains available when the native macOS service is unavailable.
- **Rust Whisper core:** persistent `oli-whisper` process using whisper.cpp via `whisper-rs`, with Metal/Core ML build features on Apple Silicon.
- **Local-first copilot:** local chat service is preferred for sovereign mode; Gemini/NVIDIA are explicit development providers.
- **SQLite + FTS5:** meetings, transcript segments, commitments, MEDDPICC fields, and trusted knowledge base.
- **Local MCP hub:** stdio tools expose meetings, transcripts, commitments, MEDDPICC, and knowledge search to local agents.
- **Local integrations:** Markdown/Notion-export indexing, Obsidian meeting-note sync, and an opt-in generic CRM webhook for completed-meeting data.
- **Privacy controls:** retention, cleanup, deletion, deterministic JSON export, and provider-mode visibility.
- **Quality tooling:** Node tests, Rust unit tests, syntax checks, structured redacted logs, GitHub Actions CI, and native release workflows.

## Architecture

    Mac / Windows
          |
    +-----+---------------------------------------+
    |                                             |
    |  Electron shell                             |
    |  - tray / hotkey / display geometry         |
    |  - protected notch renderer                 |
    |                                             |
    |      +-- macOS ScreenCaptureKit ------------+--> You / Them PCM
    |      |                                      |
    |      +-- Chromium fallback -----------------+
    |                                             |
    +---------------------> 127.0.0.1 ------------+
                              |
                       Express local API
                              |
                +-------------+-------------+
                |                           |
             SQLite + FTS5              AI runtime
                                            |
                          +-----------------+----------------+
                          |                 |                |
                       Rust Whisper      local chat       cloud adapters
                       Metal/Core ML      localhost       Gemini/NVIDIA
                          |
                    live transcript
                          |
                    SSE -> notch shelf
                              |
                       local MCP stdio

See `docs/architecture.md`.

## Requirements

- Node.js 22+
- Rust/Cargo for native Whisper builds
- macOS 15+ for ScreenCaptureKit native capture
- Xcode Command Line Tools for Swift/Cargo native builds
- A local quantized Whisper model for fully sovereign transcription
- A local chat model service compatible with the documented localhost API for fully sovereign copilot/summaries
- Gemini API key only for explicit development cloud mode

## Install

    git clone https://github.com/Aravindh-dev12/Oli-Note-Take-Agent.git
    cd Oli-Note-Take-Agent
    npm install
    cp .env.example .env

Do not commit `.env`, `data/`, model weights, transcripts, recordings, or installers.

## macOS native build

    npm run build:native:mac

This builds:

- `OliNotchGeometry`
- `OliCaptureService`
- `oli-whisper` with Metal + Core ML support

Then:

    npm run dist:mac

The release build packages the native helpers inside the app resources.

## Run

    npm start

The local API listens on `127.0.0.1:4173`. Oli stays resident in the system tray/menu bar.

On macOS, grant Microphone and Screen Recording permissions. Native capture starts automatically when the packaged capture service exists; otherwise Oli falls back to the normal Chromium share picker.

## Local Whisper

Build:

    npm run build:whisper:mac

Put the quantized GGML model somewhere outside source control and configure:

    OLI_AI_PROVIDER=local
    OLI_WHISPER_MODEL_PATH=/absolute/path/to/ggml-large-v3-turbo-q5_0.bin

For Core ML acceleration, keep the generated encoder artifact beside it using whisper.cpp's naming convention:

    ggml-large-v3-turbo-encoder.mlmodelc/

The Rust process stays resident so each short WAV chunk does not reload the model.

## Local chat

Configure a localhost OpenAI-compatible endpoint:

    OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    OLI_LOCAL_CHAT_MODEL=llama-3.2-3b

Auto mode uses native Whisper + local chat when both are configured.

## Integrations

Set `OLI_KNOWLEDGE_DIR` for a local Markdown folder. This also accepts exported Notion Markdown. Set `OLI_OBSIDIAN_VAULT_PATH` for automatic meeting-note export to an Obsidian vault, and optionally set `OLI_CRM_WEBHOOK_URL` plus `OLI_CRM_WEBHOOK_TOKEN` for an external CRM/automation webhook. CRM export is opt-in and sends structured meeting summary, MEDDPICC and commitments rather than raw audio.

## Dashboard

Open it from the notch shelf or the tray/menu bar.

The dashboard contains:

- meeting history and local transcript search
- JSON meeting export and delete
- commitments with status
- MEDDPICC fields extracted from the final meeting transcript
- trusted battlecards / pricing / product knowledge
- AI provider configuration
- privacy and retention controls

## MCP

    npm run mcp -- --db "/absolute/path/to/oli.db"

See `mcp/README.md`.

Available tools include meeting retrieval, local knowledge search, transcript search, commitments, and MEDDPICC.

## Development checks

    npm run check
    npm test
    cargo test --manifest-path native/rust/whisper-core/Cargo.toml

## Build installers

macOS:

    npm run dist:mac

Windows:

    npm run dist:win

Windows keeps browser audio capture and can use the local HTTP transcription adapter. The native macOS ScreenCaptureKit service is only packaged on macOS.

## Production boundary

The repository now contains the native capture service, persistent Rust/whisper.cpp transcription path, local-first AI selection, structured meeting intelligence, MCP integration, privacy controls, tests and release automation.

Large Whisper/LLM model weights are intentionally external runtime assets rather than Git-tracked repository files. Signing/notarization credentials are also external to the repository.

Read `docs/privacy.md`, `docs/local-ai.md`, `docs/release.md`, and `native/macos/README.md` before distributing Oli.

## Recommended Whisper model

The current whisper.cpp model repository publishes `ggml-large-v3-turbo-q5_0.bin` at about 547 MiB. Its model card also publishes the unquantized `large-v3-turbo` family. Keep the quantized GGML model outside Git and point `OLI_WHISPER_MODEL_PATH` at it. 

Example download:

    mkdir -p models
    curl -L -o models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin

Expected SHA-256 from the model card: `e050f7970618a659205450ad97eb95a18d69c9ee`. 

On Apple Silicon, optionally generate/download the matching Core ML encoder companion as `ggml-large-v3-turbo-encoder.mlmodelc` beside the GGML model. whisper.cpp derives the encoder path from the model basename. 

## Local knowledge + Notion + Obsidian

Set `OLI_KNOWLEDGE_DIR` to a local folder of Markdown files. Exported Notion pages can be dropped into this folder as Markdown; Oli indexes them into its local FTS5 knowledge store and, when a local embedding endpoint is configured, into sqlite-vec for semantic retrieval. Set `OLI_OBSIDIAN_VAULT_PATH` to an Obsidian vault to automatically write completed meeting notes under `Oli/`.

For semantic retrieval, configure a localhost OpenAI-compatible embeddings endpoint, for example:

    OLI_LOCAL_EMBEDDING_URL=http://127.0.0.1:1234/v1/embeddings
    OLI_LOCAL_EMBEDDING_MODEL=nomic-embed-text
    OLI_EMBEDDING_DIMENSIONS=768

The current sqlite-vec stable release is 0.1.9; the repository uses that pinned version rather than a floating alpha. 

## Local Llama copilot (sovereign mode)

Build the llama.cpp OpenAI-compatible server locally:

    npm run setup:local-llm

Use a licensed Llama 3.2 3B Q4 GGUF model by setting either:

    export OLI_LLAMA_MODEL_PATH=/absolute/path/to/Llama-3.2-3B-Instruct-Q4_K_M.gguf

or:

    export OLI_LLAMA_HF_REPO=<licensed-Llama-3.2-3B-Q4-GGUF-repository>

Then start the local copilot on localhost:

    export OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    npm run local:chat

In another terminal run `npm start`. On macOS, when `OliCaptureService` and `oli-whisper` are available, Oli captures both channels natively and transcribes through the persistent Rust Whisper process. The copilot path remains on the local Llama server.

See `docs/local-llm.md` for model/runtime details and `docs/local-ai.md` for the provider selection boundary.
