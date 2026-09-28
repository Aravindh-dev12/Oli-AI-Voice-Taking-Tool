# Development guide

## Requirements

- Node.js 22+
- macOS for the native notch helper and `.dmg` build
- Windows for the `.exe` build
- A local inference stack for sovereign operation, or a development provider key for non-local testing

## Install

    git clone https://github.com/Aravindh-dev12/Oli-AI-Voice-Taking-Tool.git
    cd Oli-AI-Voice-Taking-Tool
    npm install
    cp .env.example .env

Never commit `.env`, `data/`, API keys, recordings, or generated installers.

## Run

    npm start

Oli runs its API on `127.0.0.1:4173` by default, opens the protected notch-style overlay, and stays resident in the tray/menu bar.

## Local AI

Set `OLI_AI_PROVIDER=local` only after a localhost transcription endpoint and a localhost chat endpoint are available. The built-in defaults expect an OpenAI-compatible shape; endpoint details live in Dashboard → AI settings.

For auto mode, Oli uses a complete local stack when both local services are configured; otherwise it falls back to Gemini when a Gemini key is present.

## Checks

    npm run check
    npm test

## macOS native helper

    npm run build:native:mac

The helper is optional during development; the Electron shell uses the simulated island when it is unavailable.
