# Changelog

## 1.5.0

- Added Turnstone-inspired local agent workbench with shared Brain, focused agents, permission modes, approvals and Inbox.
- Added reusable Skills, local source registry and source-overlap protection.
- Added Agent Families and durable Handoffs.
- Added SQLite-backed agent jobs with leases, retries, backoff, cancellation and recovery.
- Added parallel agent batches with persisted child results and aggregated Inbox output.
- Grounded live meeting whispers in shared Brain context.
- Made CRM writes explicitly approval-gated and action execution more idempotent.
- Added Dashboard and MCP surfaces for the orchestration layer.
- Added orchestration/source/skills regression tests and 1.5.0 runtime metadata.


## 1.3.0

- Added native macOS ScreenCaptureKit dual-channel capture.
- Added persistent Rust/whisper.cpp local transcription with Metal/Core ML build flags.
- Added local-first native Whisper + localhost chat runtime.
- Added sqlite-vec semantic retrieval with FTS5 fallback.
- Added local Markdown/Notion-export ingestion.
- Added automatic Obsidian meeting-note sync.
- Added MEDDPICC extraction, persistence, dashboard rendering and MCP retrieval.
- Added persistent meeting agenda checklist and commitment status updates.
- Added native/runtime/integration regression tests and macOS native CI.

## 1.1.0

- Production root layout and desktop shell.
- Local-first AI adapters.
- SQLite/FTS knowledge base and MCP hub.
- Privacy/retention/export controls.
- CI/release automation.
