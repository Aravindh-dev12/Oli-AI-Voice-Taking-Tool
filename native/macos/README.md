# Native macOS integration

`OliNotchGeometry` is a small AppKit helper used by the Electron shell to detect the physical top-camera geometry when macOS exposes it.

Build locally on macOS:

```bash
swift build -c release
```

The Electron process looks for:

1. `native/macos/.build/release/OliNotchGeometry` during development.
2. `<resources>/native/OliNotchGeometry` in a packaged app.
3. The centered simulated island when the helper is absent.

The helper only returns display geometry. It does not capture audio, camera frames, or meeting content.
