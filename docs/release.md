# Release guide

## Development build

macOS:

    npm install
    npm run check
    npm test
    npm run dist:mac

Windows:

    npm install
    npm run check
    npm test
    npm run dist:win

## CI release

Push a semantic version tag such as `v1.1.0`. The release workflow builds a `.dmg` on macOS and an `.exe` on Windows, uploads artifacts, and publishes them to the GitHub release for the tag.

## Signing

The workflow currently produces unsigned development artifacts. For production distribution, add Apple Developer signing/notarization credentials to GitHub Actions secrets and Windows code-signing credentials to the Windows job. Do not put signing secrets in the repository.

## Pre-release checklist

- Run the complete test suite on a clean install.
- Test microphone and system-audio capture on each supported OS.
- Verify overlay content protection in the target conferencing clients.
- Verify local MLX/Whisper endpoints and model versions on Apple Silicon.
- Verify retention/export/delete behavior on a disposable data directory.
- Review privacy copy and recording/consent behavior for the jurisdictions you support.
