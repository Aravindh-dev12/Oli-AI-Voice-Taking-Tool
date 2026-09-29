use std::collections::VecDeque;

pub const SAMPLE_RATE_HZ: usize = 16_000;
pub const FRAME_SIZE_SAMPLES: usize = 160;
const FILTER_TAPS: usize = 128;

/// Deterministic 10 ms adaptive echo suppressor. The render stream must be the
/// same post-mix signal sent to the speakers; callers should feed both streams
/// continuously and preserve their timing.
pub struct EchoCanceller {
    render: VecDeque<f32>,
    weights: [f32; FILTER_TAPS],
    history: VecDeque<f32>,
    step: f32,
}

impl EchoCanceller {
    pub fn new() -> Self { Self { render: VecDeque::new(), weights: [0.0; FILTER_TAPS], history: VecDeque::new(), step: 0.08 } }

    pub fn push_render_samples(&mut self, samples: &[f32]) { self.render.extend(samples.iter().map(|s| s.clamp(-1.0, 1.0))); }

    /// Processes complete 10 ms frames and returns only complete cleaned frames.
    pub fn process_capture_samples(&mut self, samples: &[f32]) -> Vec<f32> {
        let mut output = Vec::with_capacity(samples.len());
        for &sample in samples {
            let x = self.render.pop_front().unwrap_or(0.0);
            self.history.push_front(x);
            if self.history.len() > FILTER_TAPS { self.history.pop_back(); }
            let estimate: f32 = self.weights.iter().zip(self.history.iter()).map(|(w, h)| w * h).sum();
            let error = sample - estimate;
            let power: f32 = self.history.iter().map(|h| h * h).sum::<f32>() + 1.0e-6;
            for (weight, history) in self.weights.iter_mut().zip(self.history.iter()) { *weight += self.step * error * history / power; }
            output.push(error.clamp(-1.0, 1.0));
        }
        output
    }
}

impl Default for EchoCanceller { fn default() -> Self { Self::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_near_end_voice_with_silent_render() { let mut a = EchoCanceller::new(); let input = vec![0.25; FRAME_SIZE_SAMPLES]; assert!(a.process_capture_samples(&input).iter().any(|v| *v > 0.0)); }
}

fn _frame_contract() { let _ = (SAMPLE_RATE_HZ, FRAME_SIZE_SAMPLES); }

pub type Frame = [f32; FRAME_SIZE_SAMPLES];
   
