use ed25519_dalek::{Signature, SigningKey, Signer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ZeroEgressManifest { pub session_id: String, pub started_at_epoch: u64, pub ended_at_epoch: u64, pub audio_duration_seconds: u32, pub transcript_sha256: String, pub stt_model_sha256: String, pub slm_model_sha256: String, pub os_network_egress_bytes: u64, pub signature_hex: String, pub verifier_public_key_hex: String }

pub struct AttestationEngine { key: SigningKey }
impl AttestationEngine {
    pub fn from_key(bytes: [u8; 32]) -> Self { Self { key: SigningKey::from_bytes(&bytes) } }
    pub fn manifest(&self, session_id: &str, started: u64, ended: u64, duration: u32, transcript: &[u8], stt: &[u8], slm: &[u8], egress: u64) -> ZeroEgressManifest {
        let th = digest(transcript); let sh = digest(stt); let lh = digest(slm);
        let payload = format!("v1|{session_id}|{started}|{ended}|{duration}|{th}|{sh}|{lh}|{egress}");
        let signature: Signature = self.key.sign(payload.as_bytes());
        ZeroEgressManifest { session_id: session_id.into(), started_at_epoch: started, ended_at_epoch: ended, audio_duration_seconds: duration, transcript_sha256: th, stt_model_sha256: sh, slm_model_sha256: lh, os_network_egress_bytes: egress, signature_hex: hex::encode(signature.to_bytes()), verifier_public_key_hex: hex::encode(self.key.verifying_key().to_bytes()) }
    }
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

#[cfg(test)]
mod tests { use super::*; #[test] fn manifest_is_signed() { let m = AttestationEngine::from_key([7;32]).manifest("s",1,2,1,b"t",b"a",b"b",0); assert_eq!(m.transcript_sha256.len(),64); assert!(!m.signature_hex.is_empty()); } }
   
