# Oli architecture

Oli is a tray-resident desktop copilot with a protected notch overlay, local SQLite persistence, provider-neutral AI runtime, and a local MCP bridge.

## Runtime

1. Electron owns the desktop lifecycle, tray, global hotkey, display positioning, and protected overlay window.
2. The renderer owns the three visual states and explicit microphone/system-audio capture. It never receives provider secrets.
3. Express runs only on `127.0.0.1` and exposes meeting, SSE, settings, privacy, export, and knowledge APIs.
4. SQLite is the source of truth for meetings, transcript segments, commitments, and FTS knowledge.
5. The AI runtime selects local inference first in `auto` mode. Local endpoints are restricted to localhost; Gemini/NVIDIA adapters are explicit alternatives.
6. The macOS AppKit helper supplies physical notch geometry. Non-notched/external displays use the simulated floating island.
7. `mcp/server.js` exposes local meeting intelligence over stdio without touching API keys.

## Data flow

Audio -> renderer capture -> localhost API -> AI adapter -> SQLite -> SSE -> notch shelf

Knowledge base -> SQLite FTS -> whisper context -> copilot adapter -> SSE -> flare/shelf

SQLite -> local MCP stdio server -> Claude/Cursor/local agents

## Privacy boundary

The desktop process is the trust boundary for credentials. Local mode sends audio/text only to localhost-configured inference endpoints. Cloud mode is explicit and documented in Settings. Overlay content protection is enabled for the notch window.

## Native macOS boundary

`native/macos/Sources/OliNotchGeometry/main.swift` is deliberately small: it reads AppKit display geometry and prints JSON. Audio capture and inference remain separate services so platform-native work can evolve without coupling the UI to model implementations.
