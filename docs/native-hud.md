# Native macOS HUD

Oli uses a native SwiftUI/AppKit HUD on macOS when the packaged `OliHUD` binary is available.

## Window architecture

`OliHUD` creates a borderless, non-activating `NSPanel` at status-bar level. The panel:

- stays visible across Spaces and full-screen apps,
- does not become key/main,
- uses `NSWindow.SharingType.none`,
- repositions when display parameters change,
- animates between ambient, whisper-flare and command-shelf sizes.

The SwiftUI view owns presentation state. Electron remains the authoritative meeting/capture/AI engine.

## IPC

Electron sends JSONL messages to the HUD over stdin:

- `{"type":"state","state":"ambient|flare|shelf"}`
- `{"type":"meeting","active":true,"talkRatio":0.42,"commitments":2}`
- `{"type":"transcript","speaker":"Them","text":"..."}`
- `{"type":"whisper","whisper":"...","source":"..."}`
- `{"type":"action","task":"..."}`

The HUD sends JSONL events over stdout:

- `{"event":"startMeeting"}`
- `{"event":"endMeeting"}`
- `{"event":"toggleMeeting"}`
- `{"event":"dashboard"}`

## Fallback

When `OliHUD` is unavailable or exits, Electron re-shows its existing protected notch renderer. This preserves the meeting engine instead of terminating the session.

## Build

From macOS:

```bash
npm run build:native:mac
npm start
```

The packaged release includes `OliHUD` in macOS resources. Non-macOS platforms keep the existing Electron notch renderer.
