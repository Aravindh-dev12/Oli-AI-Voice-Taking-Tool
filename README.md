# Oli — sovereign notch-style meeting copilot

A desktop overlay that docks at the top of your screen, listens to both sides of a
call, and whispers real-time talking points — built with Electron so the same
app runs on both Mac and Windows.

## Read this first — what "notch" means on each OS

- **macOS with a physical notch:** Oli docks a small black bar at the very top
  center of the screen, right under the camera. It is not pixel-fused into the
  actual hardware cutout — that level of fit needs Apple's private
  `NSScreen.auxiliaryTopLeftArea` API, which only Swift/AppKit can call, not a
  Chromium-based app. What's here gets visually close and sits in the same spot.
- **macOS without a notch, and all Windows laptops:** Windows laptops don't have
  a notch to dock into, so Oli shows the same floating black island at the top
  center of the screen. This is intentional, not a fallback bug — it's the same
  approach your own research doc describes for non-notch displays.
- If you want the literal, pixel-perfect notch fit on Mac specifically, that
  means writing native Swift/AppKit (`NSPanel` + `NSScreen.auxiliaryTopLeftArea`)
  talking to this same backend over HTTP/SSE. That's a separate, Mac-only
  project this build doesn't include.

## What's real in this build

- **Three states**, matching your spec: a resting pill, a whisper flare that
  auto-dismisses after 5 seconds, and a command shelf (live transcript +
  in-flight intelligence + action items) on hover or `Alt+Space`.
- **Dual-track capture, hardware-separated:** your microphone is "You", the
  shared tab/system audio is "Them" — no diarization model needed.
- **Gemini** transcribes each ~6-second audio chunk and writes the end-of-call
  summary and action items.
- **NVIDIA's hosted API** (free credits at build.nvidia.com) generates the
  real-time whisper text, grounded only in what you save in the knowledge base.
  If you don't set an NVIDIA key, whispers fall back to Gemini automatically.
- **SQLite** (with FTS5) stores meetings, transcripts, action items, and the
  knowledge base — one local file, no cloud database.
- **Screen-share invisibility is real**: `win.setContentProtection(true)` maps
  to `NSWindow.sharingType = .none` on macOS and `SetWindowDisplayAffinity`
  on Windows. Both hide the overlay from screen shares and recordings.
- Strict black-and-white UI throughout, both the notch and the dashboard.

## What's NOT included

- The native Swift notch-fit described above.
- NVIDIA's speech models (Parakeet/Canary) aren't wired in — Gemini handles
  transcription. See "Swapping in NVIDIA speech" below for how to add it.
- Code signing / notarization for the installers (see Packaging).
- Auth, multi-user accounts, and cloud sync — this is a single-user local app.
- Automatic local Mac notch-width detection — Oli uses a fixed, reasonable
  pill size rather than measuring your exact model's cutout.

## Setup

```bash
cp .env.example .env
# then get keys and paste them in — either into .env, or later into
# the Dashboard's Settings tab once the app is running (Settings writes
# to data/config.json and takes effect immediately, no restart needed)
npm install
npm start
```

- Gemini key (required): https://aistudio.google.com/apikey — free tier.
- NVIDIA key (optional, recommended for speed): https://build.nvidia.com —
  browse "Models", pick a chat model such as `meta/llama-3.1-8b-instruct`,
  and generate an API key from there. Free credits, rate-limited.

### First run permissions

- **macOS:** System Settings → Privacy & Security → grant Oli both
  **Microphone** and **Screen Recording**. Screen Recording is what lets the
  browser's "share tab/system audio" picker work at all.
- **Windows:** Windows will prompt for microphone access on first use. The
  "share system audio" checkbox appears in Chromium's own share-screen dialog
  when you click Start — tick it, or audio from the other participants won't
  be captured.
- Starting a meeting always triggers the OS's normal screen/tab-share picker
  — Oli cannot capture system audio silently, and it shouldn't be able to.

### Using it

- Click the pill to start a meeting; hover it (or `Alt+Space`) to open the
  command shelf and see the live transcript.
- The tray icon (bottom-right on Windows, menu bar on Mac) has "Open
  dashboard" — that's where meeting history, the knowledge base, and API
  settings live.
- Whispers only fire once a knowledge-base entry exists to ground them in —
  add battlecards and pricing sheets in Dashboard → Knowledge base first.

## Packaging installers

This project can't be built into a `.dmg` or `.exe` from this sandbox — that
needs a real macOS machine (for the Mac build, unsigned is fine for personal
use) or a real Windows machine, since `electron-builder` cross-compiles
natively per OS. On your own machine:

```bash
npm run dist:mac    # produces a .dmg  (run this on a Mac)
npm run dist:win    # produces an installer .exe (run this on Windows)
```

Unsigned builds will trigger Gatekeeper/SmartScreen warnings on first launch;
that's expected without a paid Apple Developer / code-signing certificate.

## Swapping in NVIDIA speech models

NVIDIA hosts Riva ASR models (e.g. `parakeet-tdt-1.1b`) for free at
build.nvidia.com/explore/speech. To use one instead of Gemini for
transcription, replace the `gemini(...)` call inside the
`/api/meetings/:id/chunk` handler in `server/index.js` with a call to
NVIDIA's ASR gRPC/REST endpoint for that model, keeping the WAV chunk format
already produced by `notch.js`. Left out of this build because NVIDIA's
speech endpoints need their own SDK setup separate from the chat-completions
endpoint used for whispers.

## Project layout

```
oli/
  server/     Express API: meetings, live SSE stream, transcription, KB, settings
  electron/   main.js (window + tray + server bootstrap), preload.js (IPC bridge)
  renderer/   notch.html/css/js (overlay UI), dashboard.html/css/js (history/KB/settings)
  assets/     tray + app icons
  data/       SQLite DB + config.json (created on first run)
```
