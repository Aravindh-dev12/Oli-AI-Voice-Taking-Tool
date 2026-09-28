# Local AI adapter contract

Oli keeps the sovereign inference boundary local. The application accepts a localhost transcription endpoint and a localhost chat endpoint; it does not bundle multi-gigabyte model weights in the repository.

## Transcription endpoint

Configure `OLI_LOCAL_TRANSCRIPTION_URL` to a localhost HTTP endpoint that accepts multipart form data with:

- `file`: WAV audio, 16 kHz, mono, 16-bit PCM
- `model`: the configured transcription model name

The response should be JSON containing one of `text`, `output`, or `transcript`.

## Chat endpoint

Configure `OLI_LOCAL_CHAT_URL` to an OpenAI-compatible `/chat/completions` endpoint. Oli sends `model`, `temperature`, and `messages`. The response should contain `choices[0].message.content`, or a compatible `output`/`response` field.

## Recommended deployment boundary

Run both local services on `127.0.0.1`. The adapter rejects non-local URLs. Model runtime selection, quantization, Metal/MLX acceleration, and model downloads are intentionally outside the Electron UI so they can evolve independently.

## Example environment

    OLI_AI_PROVIDER=local
    OLI_LOCAL_TRANSCRIPTION_URL=http://127.0.0.1:8000/v1/audio/transcriptions
    OLI_LOCAL_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
    OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    OLI_LOCAL_CHAT_MODEL=llama-3.2-3b

Before capturing real meetings, verify the local services independently with a short test WAV and a test chat request. Then start Oli and confirm Dashboard → AI settings shows both local capabilities as configured.
