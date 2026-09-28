# Local AI adapter contract

Oli keeps the sovereign inference boundary local.

## Native Whisper / whisper.cpp

The preferred local transcription path is the Rust `oli-whisper` process in `native/rust/whisper-core`. It keeps the Whisper model loaded in memory and accepts JSONL requests containing base64-encoded 16 kHz mono 16-bit WAV audio.

Build on Apple Silicon:

    npm run build:whisper:mac

The command uses the current `whisper-rs` 0.16.0 bindings with Metal and Core ML feature flags. The bindings expose `WhisperContext`, `WhisperState::full`, and the Metal/Core ML build features. 

Set:

    OLI_AI_PROVIDER=local
    OLI_WHISPER_MODEL_PATH=/absolute/path/to/ggml-large-v3-turbo-q5_0.bin

The current whisper.cpp model registry publishes `ggml-large-v3-turbo-q5_0.bin` at about 547 MiB. 

    mkdir -p models
    curl -L -o models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin

When Core ML support is compiled, whisper.cpp derives the companion encoder directory as:

    /absolute/path/to/ggml-large-v3-turbo-encoder.mlmodelc

The GGML model remains required because the decoder still comes from the GGML model; the Core ML artifact accelerates the encoder. 

Quantized models are supported by whisper.cpp; its current documentation shows GGML `q5_0` quantization as an example. citeturn209481search5

## Local chat

Set `OLI_LOCAL_CHAT_URL` to a localhost OpenAI-compatible `/chat/completions` endpoint. The server sends `model`, `temperature`, and `messages`.

Example:

    OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    OLI_LOCAL_CHAT_MODEL=llama-3.2-3b

## Local HTTP transcription fallback

When native Whisper is unavailable, Oli can use:

    OLI_LOCAL_TRANSCRIPTION_URL=http://127.0.0.1:8000/v1/audio/transcriptions

That endpoint accepts multipart form data with a WAV file and model name and returns JSON with `text`, `output`, or `transcript`.

## Provider selection

- `auto`: complete native-Whisper + local-chat is preferred; local HTTP is next; Gemini is the development fallback.
- `local`: requires a complete local stack.
- `gemini`: explicit development cloud provider.
- `nvidia`: explicit NVIDIA copilot provider.

The native Whisper process itself makes no network calls. The cloud adapters are separate and only used when configured/selected.

## Semantic RAG with sqlite-vec

Oli can load sqlite-vec into the same local SQLite database and maintain a `vec0` table for KB embeddings. The vector path is enabled when `OLI_LOCAL_EMBEDDING_URL` is configured; FTS5 remains the fallback when embeddings are unavailable.

Current stable sqlite-vec is 0.1.9. It supports Node installation and `vec0` KNN tables. 

Configure:

    OLI_LOCAL_EMBEDDING_URL=http://127.0.0.1:1234/v1/embeddings
    OLI_LOCAL_EMBEDDING_MODEL=nomic-embed-text
    OLI_EMBEDDING_DIMENSIONS=768

The embedding endpoint is local-only. Oli sends document/query text to that localhost endpoint and stores only the resulting vectors in SQLite.
