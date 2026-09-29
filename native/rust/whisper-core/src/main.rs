use anyhow::{anyhow, Context, Result};
use base64::Engine;
use hound::{SampleFormat, WavReader};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::io::{self, BufRead, Write};
use std::io::Cursor;
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub mod attestation;
pub mod echo_canceller;
pub mod semantic_router;
pub mod vault_indexer;
pub mod throttler;

#[derive(Debug, Serialize)]
struct SegmentOut {
    start_ms: i64,
    end_ms: i64,
    text: String,
}

#[derive(Debug, Serialize)]
struct TranscriptOut {
    ok: bool,
    text: String,
    segments: Vec<SegmentOut>,
    model: String,
    engine: &'static str,
}

#[derive(Debug, Deserialize)]
struct StdioRequest {
    audio_path: Option<String>,
    audio_base64: Option<String>,
    language: Option<String>,
    threads: Option<i32>,
}

fn load_audio(path: &Path) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("failed to read WAV: {}", path.display()))?;
    load_audio_bytes(&bytes)
}

fn load_audio_bytes(bytes: &[u8]) -> Result<Vec<f32>> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut reader = WavReader::new(cursor).context("failed to parse WAV")?;

    let spec = reader.spec();
    if spec.sample_rate != 16_000 {
        return Err(anyhow!("WAV sample rate must be 16000 Hz, got {}", spec.sample_rate));
    }
    if spec.channels != 1 {
        return Err(anyhow!("WAV must be mono, got {} channels", spec.channels));
    }
    if spec.bits_per_sample != 16 || spec.sample_format != SampleFormat::Int {
        return Err(anyhow!("WAV must be signed 16-bit PCM"));
    }

    let samples = reader
        .samples::<i16>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("invalid 16-bit PCM sample")?;

    let mut audio = vec![0.0_f32; samples.len()];
    whisper_rs::convert_integer_to_float_audio(&samples, &mut audio)
        .context("failed to convert PCM to f32")?;
    Ok(audio)
}

struct WhisperEngine {
    context: WhisperContext,
    model_path: String,
}

impl WhisperEngine {
    fn new(model_path: &str) -> Result<Self> {
        if !Path::new(model_path).is_file() {
            return Err(anyhow!(
                "Whisper model not found: {}. Download a GGML/GGUF-compatible whisper.cpp model file and configure OLI_WHISPER_MODEL_PATH.",
                model_path
            ));
        }

        let mut params = WhisperContextParameters::default();
        params.use_gpu = true;
        params.flash_attn = true;

        let context = WhisperContext::new_with_params(model_path, params)
            .map_err(|e| anyhow!("failed to load Whisper model: {:?}", e))?;

        Ok(Self {
            context,
            model_path: model_path.to_owned(),
        })
    }

    fn transcribe(&self, audio_path: &str, language: Option<&str>, threads: i32) -> Result<TranscriptOut> {
        let audio = load_audio(Path::new(audio_path))?;
        self.transcribe_samples(audio, language, threads)
    }

    fn transcribe_bytes(&self, bytes: &[u8], language: Option<&str>, threads: i32) -> Result<TranscriptOut> {
        let audio = load_audio_bytes(bytes)?;
        self.transcribe_samples(audio, language, threads)
    }

    fn transcribe_samples(&self, audio: Vec<f32>, language: Option<&str>, threads: i32) -> Result<TranscriptOut> {
        if audio.is_empty() {
            return Ok(TranscriptOut {
                ok: true,
                text: String::new(),
                segments: Vec::new(),
                model: self.model_path.clone(),
                engine: "whisper.cpp",
            });
        }

        let mut state = self.context.create_state()
            .map_err(|e| anyhow!("failed to create Whisper state: {:?}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 0 });
        params.set_n_threads(threads.clamp(1, 64));
        params.set_no_context(true);
        params.set_no_timestamps(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if let Some(lang) = language.filter(|v| !v.trim().is_empty()) {
            params.set_language(Some(lang.trim()));
        }

        state.full(params, &audio[..])
            .map_err(|e| anyhow!("Whisper transcription failed: {:?}", e))?;

        let mut segments = Vec::new();
        let mut text_parts = Vec::new();
        for segment in state.as_iter() {
            let text = segment.to_string().trim().to_owned();
            if text.is_empty() {
                continue;
            }
            text_parts.push(text.clone());
            segments.push(SegmentOut {
                start_ms: segment.start_timestamp() * 10,
                end_ms: segment.end_timestamp() * 10,
                text,
            });
        }

        Ok(TranscriptOut {
            ok: true,
            text: text_parts.join(" ").trim().to_owned(),
            segments,
            model: self.model_path.clone(),
            engine: "whisper.cpp",
        })
    }
}

fn parse_args() -> Result<(String, Option<String>, Option<String>, i32)> {
    let mut args = env::args().skip(1);
    let mut model = None;
    let mut audio = None;
    let mut language = None;
    let mut threads = 4_i32;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--model" => model = args.next(),
            "--audio" => audio = args.next(),
            "--language" => language = args.next(),
            "--threads" => {
                threads = args
                    .next()
                    .ok_or_else(|| anyhow!("--threads requires a value"))?
                    .parse()
                    .context("--threads must be an integer")?;
            }
            "--stdio" => return Ok((
                model.ok_or_else(|| anyhow!("--model is required before --stdio"))?,
                None,
                language,
                threads,
            )),
            "--help" | "-h" => {
                println!("oli-whisper --model MODEL [--audio WAV] [--language en] [--threads N] [--stdio]");
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {}", other)),
        }
    }

    Ok((
        model.ok_or_else(|| anyhow!("--model is required"))?,
        audio,
        language,
        threads,
    ))
}

fn run_stdio(engine: &WhisperEngine, default_language: Option<&str>, default_threads: i32) -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<StdioRequest>(trimmed) {
            Ok(request) => {
                let language = request.language.as_deref().or(default_language);
                let threads = request.threads.unwrap_or(default_threads);
                let result = if let Some(path) = request.audio_path.as_deref() {
                    engine.transcribe(path, language, threads)
                } else if let Some(encoded) = request.audio_base64.as_deref() {
                    match base64::engine::general_purpose::STANDARD.decode(encoded) {
                        Ok(bytes) => engine.transcribe_bytes(&bytes, language, threads),
                        Err(error) => Err(anyhow!("invalid audio_base64: {}", error)),
                    }
                } else {
                    Err(anyhow!("stdio request requires audio_path or audio_base64"))
                };
                match result {
                Ok(result) => serde_json::to_value(result)?,
                    Err(error) => json!({ "ok": false, "error": error.to_string() }),
                }
            },
            Err(error) => json!({ "ok": false, "error": format!("invalid request: {}", error) }),
        };

        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;
    }
    Ok(())
}

fn main() -> Result<()> {
    let (model, audio, language, threads) = parse_args()?;
    let engine = WhisperEngine::new(&model)?;

    if audio.is_some() {
        let result = engine.transcribe(audio.as_deref().unwrap(), language.as_deref(), threads)?;
        println!("{}", serde_json::to_string(&result)?);
        return Ok(());
    }

    println!("{}", serde_json::json!({"ready": true, "engine": "whisper.cpp", "model": model}));
    io::stdout().flush()?;
    run_stdio(&engine, language.as_deref(), threads)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_parser_accepts_canonical_mono_pcm() {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = hound::WavWriter::new(
                &mut cursor,
                hound::WavSpec {
                    channels: 1,
                    sample_rate: 16_000,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            ).expect("writer");
            writer.write_sample(0_i16).expect("sample");
            writer.write_sample(1000_i16).expect("sample");
            writer.finalize().expect("finalize");
        }
        let audio = load_audio_bytes(cursor.get_ref()).expect("valid audio");
        assert_eq!(audio.len(), 2);
        assert!(audio[1] > 0.0);
    }

    #[test]
    fn wav_parser_rejects_wrong_sample_rate() {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = hound::WavWriter::new(
                &mut cursor,
                hound::WavSpec {
                    channels: 1,
                    sample_rate: 44_100,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            ).expect("writer");
            writer.write_sample(0_i16).expect("sample");
            writer.finalize().expect("finalize");
        }
        let error = load_audio_bytes(cursor.get_ref()).expect_err("must reject");
        assert!(error.to_string().contains("16000"));
    }
}
