# Native macOS layer

Oli uses two small native macOS executables:

- `OliNotchGeometry` — reads the screen's top safe-area geometry for physical-notch positioning.
- `OliCaptureService` — uses ScreenCaptureKit to capture system audio and microphone as separate stream outputs and emits 16 kHz mono WAV chunks as JSON lines on stdout.

Apple documents the auxiliary top-left/top-right screen areas around a camera housing, and ScreenCaptureKit exposes separate audio and microphone stream outputs on supported macOS releases.

## Build

From the repository root on macOS:

    npm run build:native:mac

The release binaries are placed under:

    native/macos/.build/release/OliNotchGeometry
    native/macos/.build/release/OliCaptureService

The Electron build packages both binaries into `Contents/Resources/native/`.

## Permissions

Native capture requires Screen Recording and Microphone permissions. Oli requests them before starting the native capture stream.

No screen frames are persisted. Only audio buffers are converted into short WAV chunks and forwarded to the local desktop API.

## Fallback

When the native helper is unavailable or cannot start, the renderer continues to use Chromium's microphone + display-share audio flow. This keeps Windows and non-native development environments functional.

## Screen-share privacy

Electron still enables `setContentProtection(true)` on the overlay. Current Electron documentation notes that on newer macOS applications using ScreenCaptureKit, protected windows may still be captured. Treat content protection as a best-effort OS feature and verify the exact conferencing client/OS combination before relying on it as a confidentiality guarantee.
