# Sovereign local Llama runtime

Oli uses `llama-server` from llama.cpp for the local copilot path. The llama.cpp project provides `llama-server` as an OpenAI-compatible HTTP server that can be built with CMake and bound to localhost.

## Build the runtime

From the repository root:

    npm run setup:local-llm

The script clones/updates llama.cpp under `.local/llama.cpp` and builds `llama-server` under `.local/llama-build`. On macOS it enables the Metal backend. The source and build directories are gitignored.

## Configure Llama 3.2 3B Q4

Keep the model weights outside Git. Set either:

    export OLI_LLAMA_MODEL_PATH=/absolute/path/to/Llama-3.2-3B-Instruct-Q4_K_M.gguf

or point llama.cpp at a licensed Hugging Face GGUF repository:

    export OLI_LLAMA_HF_REPO=<your-licensed-Llama-3.2-3B-Q4-GGUF-repository>

The exact model file/repository is intentionally configurable so you can use a model distribution you are licensed to use.

## Start the local copilot

    export OLI_LOCAL_CHAT_URL=http://127.0.0.1:1234/v1/chat/completions
    npm run local:chat

The launcher binds to `127.0.0.1` and passes the local model to `llama-server`.

## Start the complete sovereign Mac stack

    npm run sovereign:mac

Then, in one terminal:

    npm run local:chat

and in another:

    npm start

In Dashboard → AI settings, choose **Local**. The native macOS capture service sends only the separated audio streams to the local Oli API, and the local Whisper process performs transcription. The chat path stays on the local Llama server.

## Health and troubleshooting

Check the running server manually:

    curl -f http://127.0.0.1:1234/health

If Oli reports that local AI is not ready, verify:

1. `oli-whisper` was built with `npm run build:whisper:mac`.
2. `OLI_WHISPER_MODEL_PATH` points to an existing quantized Whisper model.
3. `llama-server` is running on `127.0.0.1:1234`.
4. `OLI_LOCAL_CHAT_URL` matches the running server.

The runtime does not require cloud AI keys for local mode.