#!/usr/bin/env python3
"""
Generate intent centroid vectors for the Semantic Router.
Produces binary .bin files with unit-normalized 384-dimensional embeddings.
"""

import os
import struct
import numpy as np

OUTPUT_DIR = "centroids"

# Curated exemplars mapping 6 enterprise conversational intents
INTENT_EXEMPLARS = {
    "competitor": [
        "We are currently piloting Competitor X for our team.",
        "How do you compare directly against Fathom and Otter?",
        "Our sales org is already heavily invested in Gong.",
        "Competitor Y offers this exact feature at half the cost.",
        "We have an active enterprise renewal coming up with Chorus.",
        "What makes your solution different from the built-in Zoom AI?",
        "We were looking at an open-source alternative like WhisperLive.",
    ],
    "pricing": [
        "That price is simply way outside of our allocated budget.",
        "Can you offer any discount if we sign a multi-year deal?",
        "We cannot justify a $25 per user monthly seat cost right now.",
        "Is there a consumption-based pricing model instead of per seat?",
        "Do you have a free tier our team can test for 3 months?",
        "Our CFO rejected the procurement order due to cost.",
        "Are there extra charges for transcription minutes and storage overages?",
    ],
    "compliance": [
        "Where is our meeting audio uploaded and stored geographically?",
        "Do you have a completed SOC2 Type II audit report available?",
        "We need to execute a HIPAA Business Associate Agreement before rollout.",
        "Our legal counsel strictly prohibits routing client audio to cloud APIs.",
        "Is this deployment GDPR compliant with European data residency?",
        "Can we run this fully on-premise without external Internet access?",
        "Are employee voiceprints used to train third-party foundation models?",
    ],
    "timeline": [
        "Our engineering team is at capacity until next fiscal quarter.",
        "We won't be ready to evaluate new tools until November.",
        "Implementation seems complex; how long does migration typically take?",
        "We have a temporary freeze on new software vendor onboarding.",
        "Let's reconnect in Q1 once our new director starts.",
        "We don't have the IT resources to deploy desktop software right now.",
    ],
    "sla": [
        "What is your uptime guarantee under the enterprise SLA?",
        "What happens if your local inference engine drops below 30 frames per second?",
        "Can the system handle a 3-hour long call without crashing the memory?",
        "How do you handle audio latency when someone is speaking fast?",
        "Is there dedicated 24/7 technical support included with this license?",
        "What is the maximum number of concurrent participants you can diarize?",
    ],
    "commitment": [
        "I will make sure to send over that revised proposal by Friday.",
        "Let me follow up with the finance team and get back to you.",
        "I'll share the API documentation link right after this call.",
        "We will schedule a technical deep-dive for next Tuesday morning.",
        "I promise to look over the security questionnaire before our next sync.",
        "I will introduce you to our VP of Procurement via email today.",
    ],
}


def export_centroids():
    """Generate and export intent centroids."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Generating {len(INTENT_EXEMPLARS)} intent centroids...")

    centroids = {}

    # In production: Load sentence-transformers model and generate embeddings
    # For now, generate mock 384-dimensional vectors
    for intent, examples in INTENT_EXEMPLARS.items():
        # Mock embedding: hash-based deterministic vectors
        np.random.seed(hash(intent) % 2**32)
        embeddings = np.random.randn(len(examples), 384).astype(np.float32)

        # Normalize each embedding to unit length
        for i in range(len(embeddings)):
            norm = np.linalg.norm(embeddings[i])
            if norm > 0:
                embeddings[i] /= norm

        # Calculate mean centroid
        centroid = np.mean(embeddings, axis=0)
        unit_centroid = centroid / np.linalg.norm(centroid)
        centroids[intent] = unit_centroid.astype(np.float32)

        # Write binary file
        bin_path = os.path.join(OUTPUT_DIR, f"{intent}.bin")
        with open(bin_path, "wb") as f:
            for val in unit_centroid:
                f.write(struct.pack("<f", val))

        print(f"  ✓ {intent}.bin -> {len(unit_centroid)} dimensions")

    # Inter-cluster distance verification
    print("\n--- Inter-Centroid Cosine Similarity Matrix ---")
    keys = list(centroids.keys())
    header = f"{'Intent':<12}" + "".join([f"{k[:6]:>8}" for k in keys])
    print(header)
    print("-" * len(header))

    for k1 in keys:
        row = f"{k1:<12}"
        for k2 in keys:
            sim = np.dot(centroids[k1], centroids[k2])
            row += f"{sim:>8.3f}"
        print(row)

    print("\n✓ Centroid generation complete")


if __name__ == "__main__":
    export_centroids()
