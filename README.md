# Oli — sovereign notch meeting copilot

Oli is a tray-resident desktop meeting copilot designed around a black notch-style HUD: ambient when quiet, a short whisper flare for important live cues, and a command shelf for transcript and meeting intelligence.

## What is implemented

- **Ambient notch HUD:** black pill, whisper flare, and command shelf states.
- **Protected overlay:** Electron content protection is enabled for the overlay so supported OS capture paths can exclude it.
- **Dual-channel capture:** microphone is `You`; shared tab/system audio is `Them`.
- **Bounded audio pipeline:** 16 kHz mono PCM WAV, silence filtering, sequence IDs, upload backpressure, and cleanup.
- **Local-first AI runtime:** Auto mode prefers a complete localhost transcription + chat stack. Gemini and NVIDIA remain optional development providers.
- **Local SQLite:** meetings, transcript segments, action items, and FTS knowledge base.
- **Local MCP hub:** stdio tools expose meetings, transcripts, commitments, and knowledge search to local agents.
- **macOS notch geometry helper:** AppKit reads display safe areas and physical notch width; non-notched displays use a centered simulated island.
- **Privacy controls:** retention policy, cleanup, explicit meeting export, deletion, and provider-mode visibility.
- **Reliability tooling:** Node tests, syntax checks, structured redacted logs, CI, and platform release workflows.

## Architecture

    Electron shell
        |
        +--> protected notch renderer
        |       +--> microphone capture
        |       +--> system/tab audio capture
        |       +--> SSE live shelf
        |
        +--> localhost Express API
                |
                +--> SQLite + FTS5
                +--> local-first AI runtime
                |      +--> localhost transcription
                |      +--> localhost chat
                |      +--> optional Gemini / NVIDIA
                |
                +--> local MCP stdio hub

See `docs/architecture.md`.

## Requirements

- Node.js 22+
- macOS for the native notch helper and `.dmg` build
- Windows for the `.exe` build
- For sovereign mode: a localhost transcription endpoint and localhost chat endpoint compatible with the documented adapter shape
- For development cloud mode: a Gemini API key; NVIDIA is optional for whispers

## Install

```bash
git clone https://github.com/Aravindh-dev12/Oli-AI-Voice-Taking-Tool.git
cd Oli-AI-Voice-Taking-Tool
npm install
cp .env.example .env
```

Never commit `.env`, `data/`, credentials, transcripts, recordings, or installers.

## Run

```bash
npm start
```

The local API listens on `127.0.0.1`:4173 by default. Oli stays resident in the system tray/menu bar.

On macOS, grant Microphone and Screen Recording permissions when prompted. Starting a meeting uses the normal OS capture picker; choose the relevant tab/system-audio source.

## AI configuration

Dashboard → **AI settings** supports:

- `Auto`: use a complete local stack when available, otherwise Gemini.
- `Local`: require localhost transcription and chat endpoints.
- `Gemini`: explicit development cloud provider.
- `NVIDIA`: explicit copilot provider; transcription still requires a configured transcription provider.

The local adapter accepts an OpenAI-compatible chat endpoint and a multipart transcription endpoint. Exact environment variables are documented in `.env.example` and `docs/development.md`.

## MCP

Run:

```bash
npm run mcp -- --db "/absolute/path/to/oli.db"
```

See `mcp/README.md` for Claude/Cursor-style configuration.

## Development checks

```bash
npm run check
npm test
```

## Build installers

macOS:

```bash
npm run dist:mac
```

Windows:

```bash
npm run dist:win
```

The macOS build compiles the AppKit notch geometry helper first.

Unsigned artifacts are development artifacts. See `docs/release.md` for signing, notarization, and production release steps.

## Repository workflow

The implementation is split into issue-backed feature branches and PRs. Every PR should use the repository template, run CI, and receive review before merge.

Issues:
- #1 root layout
- #2 notch shell
- #3 audio pipeline
- #4 local AI
- #5 MCP/RAG
- #6 privacy/dashboard
- #7 tests/observability
- #8 CI/release

## Important production boundary

The repository now contains a production-grade application foundation and the interfaces required for sovereign/local inference, but it does **not** vendor large Whisper/LLM model weights or a complete Apple Neural Engine runtime. Those remain deployable local services behind the localhost adapter, keeping the app itself independent of a cloud audio pipeline.

See `docs/privacy.md`, `docs/architecture.md`, and `docs/release.md` before distributing the application.
