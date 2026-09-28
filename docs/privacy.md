# Privacy and data handling

Oli is designed for local-first operation, but the configured AI provider determines where captured text/audio is processed.

## Local mode

When `OLI_AI_PROVIDER=local` or Auto selects the local stack, the inference endpoints must be localhost/127.0.0.1. The app does not accept remote URLs for the local adapter.

## Cloud mode

Gemini and NVIDIA adapters are explicit network providers. Audio/text sent through them leaves the Mac/PC. Review provider terms and meeting-recording requirements before using cloud mode with sensitive content.

## Stored data

SQLite stores meetings, transcript segments, summaries, commitments, and knowledge-base entries. Dashboard → Privacy & data lets you inspect counts, configure retention, run cleanup, export a meeting, and delete meetings.

## Screen-share protection

The notch window uses Electron content protection. Treat this as a platform feature, not a confidentiality guarantee: always verify the behavior in the specific meeting/recording client and OS version you deploy to.

## Local integrations

Markdown/Notion-export knowledge is read from the configured local folder only. Obsidian sync writes meeting notes to the configured local vault. Semantic embeddings, when enabled, target the configured localhost embedding endpoint.
