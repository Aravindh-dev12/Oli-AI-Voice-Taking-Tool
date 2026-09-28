# Oli architecture

Oli is a tray-resident desktop copilot with a protected notch renderer, native macOS capture, a Rust/whisper.cpp transcription core, local SQLite state, a local-first copilot runtime, and a local MCP bridge.

## Runtime components

1. **Electron shell**
   - tray/menu-bar lifecycle
   - global `Alt+Space` hotkey
   - protected notch-style BrowserWindow
   - display/geometry management
   - IPC boundary for native capture

2. **Native macOS capture**
   - `OliCaptureService` uses ScreenCaptureKit
   - `.audio` is mapped to `Them`
   - `.microphone` is mapped to `You`
   - output is 16 kHz mono 16-bit WAV in short chunks
   - no screen output stream is persisted

3. **Renderer**
   - ambient pill
   - whisper flare
   - command shelf
   - transcript, talk-time meter, intelligence feed, commitments
   - Chromium microphone/display-share audio fallback on non-native environments

4. **Local server**
   - binds only to `127.0.0.1`
   - Express API
   - SSE live events
   - SQLite persistence
   - FTS5 knowledge retrieval
   - retention/export/delete APIs

5. **Rust Whisper core**
   - `native/rust/whisper-core`
   - `whisper-rs 0.16.0` bindings to whisper.cpp
   - persistent process mode keeps the model loaded
   - input is base64-encoded 16 kHz mono 16-bit WAV
   - Metal and Core ML feature flags are available for Apple Silicon

6. **AI runtime**
   - Auto prefers a complete native-Whisper + localhost-chat stack
   - Local mode requires a complete local stack
   - Gemini/NVIDIA are isolated compatibility providers
   - provider errors remain inside the meeting lifecycle

7. **Meeting intelligence**
   - transcript segments
   - commitments/actions
   - structured MEDDPICC fields
   - trusted KB context for whisper generation

8. **MCP**
   - stdio-only
   - reads the same local SQLite source of truth
   - exposes meeting retrieval, transcript/KB search, commitments and MEDDPICC

## Data flow

    Audio
      -> native ScreenCaptureKit or Chromium fallback
      -> 127.0.0.1 /api/meetings/:id/chunk
      -> AI runtime
      -> SQLite
      -> SSE
      -> notch shelf

    Them transcript
      -> FTS knowledge lookup
      -> local/cloud copilot
      -> whisper flare / shelf

    Meeting end
      -> transcript
      -> summarizer
      -> summary + actions + MEDDPICC
      -> SQLite
      -> dashboard + MCP

## Privacy boundary

The Electron/server process is the credential trust boundary. Local inference targets localhost only. Cloud providers are explicit configuration options.

The overlay enables Electron content protection, but current macOS ScreenCaptureKit behavior means protected windows cannot be treated as an absolute screen-share confidentiality guarantee. Validate the exact conferencing client and OS version you ship against.

## Native macOS model acceleration

On Apple Silicon, whisper.cpp can use Metal for GPU execution and Core ML for encoder execution on the Apple Neural Engine when the corresponding build features and companion Core ML encoder artifact are present. The GGML model remains required for the decoder. The current whisper.cpp runtime derives the encoder path from the model filename and loads the `-encoder.mlmodelc` companion. 

## Latency boundary

Oli's native audio pipeline is designed for low-latency local streaming, but end-to-end sub-second latency depends on capture chunk size, local model size/quantization, Apple Silicon load, and the conferencing client's audio routing. The repository does not guarantee a universal sub-second SLA.
