#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentTrigger { Competitor, Pricing, Compliance, Timeline, TechnicalSla, Commitment }

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IntentMatch { pub intent: IntentTrigger, pub score: f32 }

/// Runtime-neutral router. Production builds can provide an ONNX embedding
/// through `classify_embedding`; keeping inference outside this type makes the
/// decision boundary deterministic on Metal, CoreML, DirectML and CPU.
pub struct SemanticRouter { centroids: Vec<(IntentTrigger, Vec<f32>)>, threshold: f32 }

impl SemanticRouter {
    pub fn new(centroids: Vec<(IntentTrigger, Vec<f32>)>, threshold: f32) -> Result<Self, String> {
        if centroids.is_empty() || centroids.iter().any(|(_, v)| v.is_empty()) { return Err("centroids must not be empty".into()); }
        let dimensions = centroids[0].1.len();
        if centroids.iter().any(|(_, v)| v.len() != dimensions) { return Err("centroids must share a dimension".into()); }
        Ok(Self { centroids, threshold: threshold.clamp(0.0, 1.0) })
    }
    pub fn classify_embedding(&self, embedding: &[f32]) -> Option<IntentMatch> {
        if embedding.len() != self.centroids.first()?.1.len() { return None; }
        let query_norm = embedding.iter().map(|v| v * v).sum::<f32>().sqrt();
        if query_norm == 0.0 { return None; }
        self.centroids.iter().map(|(intent, centroid)| {
            let norm = centroid.iter().map(|v| v * v).sum::<f32>().sqrt();
            let score = if norm == 0.0 { 0.0 } else { embedding.iter().zip(centroid).map(|(a,b)| a*b).sum::<f32>() / (query_norm * norm) };
            IntentMatch { intent: *intent, score }
        }).max_by(|a,b| a.score.total_cmp(&b.score)).filter(|m| m.score >= self.threshold)
    }
    pub fn threshold(&self) -> f32 { self.threshold }
}

#[cfg(test)]
mod tests { use super::*; #[test] fn gates_below_threshold() { let r = SemanticRouter::new(vec![(IntentTrigger::Pricing, vec![1.0,0.0])], 0.72).unwrap(); assert!(r.classify_embedding(&[0.0,1.0]).is_none()); assert_eq!(r.classify_embedding(&[1.0,0.0]).unwrap().intent, IntentTrigger::Pricing); } }
   
