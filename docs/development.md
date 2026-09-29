# Development guide

## Requirements

- Node.js 22+
- Rust/Cargo
- Xcode Command Line Tools on macOS
- macOS 15+ for native ScreenCaptureKit capture
- Windows for Windows packaging
- A local quantized Whisper model for sovereign transcription
- A local chat service for sovereign copilot/summaries, or an explicitly configured cloud provider for development

## Install

    git clone https://github.com/Aravindh-dev12/Oli-Note-Take-Agent.git
    cd Oli-Note-Take-Agent
    npm install
    cp .env.example .env

Never commit `.env`, `data/`, model weights, transcripts, recordings, or installers.

## Run

    npm start

Oli runs the Express API on 127.0.0.1:4173, creates the protected notch renderer, and stays resident in the tray/menu bar.

## Native macOS stack

Build all native components:

    npm run build:native:mac

This compiles:

- `OliNotchGeometry`
- `OliCaptureService`
- `oli-whisper` with Metal + Core ML

The capture service is selected automatically on macOS when its packaged binary exists. It requests Microphone and Screen Recording permissions and emits separate `You` and `Them` audio channels.

## Whisper model

Do not commit model weights.

Configure:

    OLI_AI_PROVIDER=local
    OLI_WHISPER_MODEL_PATH=/absolute/path/to/ggml-large-v3-turbo-q5_0.bin

On Apple Silicon, the Core ML encoder companion should be beside the GGML model:

    ggml-large-v3-turbo-encoder.mlmodelc/

See `docs/local-ai.md`.

## Local chat

Configure a localhost OpenAI-compatible endpoint:

    OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    OLI_LOCAL_CHAT_MODEL=llama-3.2-3b

Auto mode prefers native Whisper + local chat when both are configured.

## Browser fallback

When the native macOS service is unavailable, the renderer falls back to:

- `getUserMedia` for microphone
- `getDisplayMedia` with audio for tab/system audio

This remains the supported path for Windows and development machines without the native service.

## Checks

    npm run check
    npm test
    cargo test --manifest-path native/rust/whisper-core/Cargo.toml

On macOS also run:

    cargo build --release --manifest-path native/rust/whisper-core/Cargo.toml --features metal,coreml

## Release build

macOS:

    npm run dist:mac

Windows:

    npm run dist:win

## Knowledge and Obsidian integrations

Point `OLI_KNOWLEDGE_DIR` at a local Markdown folder. This is also the recommended way to bring a Notion export into Oli: export the relevant workspace/pages to Markdown, place the files in the folder, and click Dashboard → AI settings → Sync Markdown.

Set `OLI_OBSIDIAN_VAULT_PATH` to a local Obsidian vault. After a meeting is completed, Oli writes a Markdown note beneath `Oli/` containing summary, MEDDPICC, commitments and transcript.

For semantic RAG, configure the local embedding endpoint and dimension:

    OLI_LOCAL_EMBEDDING_URL=http://127.0.0.1:1234/v1/embeddings
    OLI_LOCAL_EMBEDDING_MODEL=nomic-embed-text
    OLI_EMBEDDING_DIMENSIONS=768

## Sovereign local AI on macOS

    npm run sovereign:mac
    export OLI_LLAMA_MODEL_PATH=/absolute/path/to/Llama-3.2-3B-Instruct-Q4_K_M.gguf
    export OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    npm run local:chat
    npm start

`sovereign:mac` builds the native Swift capture helpers and Rust Whisper core, then builds `llama-server`. Model weights remain external and are not committed to the repository.

## CRM webhook

Set `OLI_CRM_WEBHOOK_URL` to an HTTP/HTTPS automation endpoint. Optionally set `OLI_CRM_WEBHOOK_TOKEN` for a Bearer token. When a meeting ends, Oli queues a reviewable approval for the structured meeting record, summary, MEDDPICC fields and commitment statuses. The external POST occurs only after approval. Audio is never included in the CRM payload.


## Agent workbench

Start Oli normally and open Dashboard → Agents. The default agents are:

- Meeting Analyst — always-allow for Brain memory and Inbox drafts only.
- Follow-up Planner — ask-first for commitments, Obsidian and CRM side effects.
- Local Researcher — read-only.

The Brain is shared across agents and stored in the same local SQLite file. Schedules are local fixed intervals between 1 minute and 7 days.

MCP can run agents against the same state:

    npm run mcp -- --db "/absolute/path/to/oli.db" --config "/absolute/path/to/config.json"

Meeting-complete CRM sync is approval-gated. Review it in Dashboard → Agents or through oli_list_approvals / oli_resolve_approval before the external webhook is called.

See docs/agents.md for the full lifecycle and privacy behavior.


### Skills

Use Dashboard → Agents to select a reusable skill before a run. Built-ins include Meeting Brief, Meeting Follow-up, Account Research and Risk Review. Custom skills are stored locally in SQLite.

### Multiple local sources

Use Dashboard → Agents → Connected local sources to register additional Markdown roots. Each file can belong to one registered source only. Source sync updates FTS locally; configure the existing localhost embedding endpoint when semantic indexing is desired.

### Durable orchestration

Scheduled work is persisted as jobs. Use the Agent dashboard to inspect pending/processing/failed jobs and manually retry or cancel them.

MCP supports local handoffs and parallel batches. A batch accepts up to eight independent agent requests and writes an aggregate result to the local Inbox.
