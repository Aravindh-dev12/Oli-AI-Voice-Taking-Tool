import React from "react";

interface GazeAlignedProps {
  cueText: string;
  category: "OBJECTION" | "PRICING" | "COMPLIANCE" | "SLA" | "COMPETITOR" | "TIMELINE";
}

/**
 * GazeAlignedPrompt renders a sub-300ms Notch HUD cue with optical
 * gaze alignment. The prompt is positioned 4-6mm below the camera lens,
 * creating a vertical gaze divergence of only ~0.67°, which is imperceptible
 * to remote participants (threshold is 2.5°).
 *
 * The component uses RSVP (Rapid Serial Visual Presentation) principles:
 * - Fixed 320px width prevents horizontal eye saccades
 * - 9-11px monospace font for crisp readability in the notch
 * - Amber/orange accent for high-stakes objections
 * - Auto-fade after 5 seconds
 */
export const GazeAlignedPrompt: React.FC<GazeAlignedProps> = ({
  cueText,
  category,
}) => {
  const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
    OBJECTION: {
      bg: "bg-amber-500/20",
      text: "text-amber-300",
      border: "border-amber-500/40",
    },
    PRICING: {
      bg: "bg-rose-500/20",
      text: "text-rose-300",
      border: "border-rose-500/40",
    },
    COMPLIANCE: {
      bg: "bg-blue-500/20",
      text: "text-blue-300",
      border: "border-blue-500/40",
    },
    SLA: {
      bg: "bg-purple-500/20",
      text: "text-purple-300",
      border: "border-purple-500/40",
    },
    COMPETITOR: {
      bg: "bg-orange-500/20",
      text: "text-orange-300",
      border: "border-orange-500/40",
    },
    TIMELINE: {
      bg: "bg-slate-500/20",
      text: "text-slate-300",
      border: "border-slate-500/40",
    },
  };

  const colors = categoryColors[category] || categoryColors.OBJECTION;

  return (
    <div
      className="fixed top-12 left-1/2 -translate-x-1/2 flex flex-col items-center justify-start w-[320px] text-center select-none z-50 pointer-events-none"
      style={{
        animation: "fadeInOut 5s ease-in-out forwards",
      }}
    >
      {/* Category Pill - Positioned 4mm below sensor */}
      <span
        className={`text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}
      >
        {category}
      </span>

      {/* Primary Punchline - 1-2 lines max, high-contrast monospace */}
      <p className="mt-1.5 text-[11px] leading-[14px] font-semibold text-neutral-100 tracking-tight text-balance">
        {cueText}
      </p>

      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -4px); }
          10% { opacity: 1; transform: translate(-50%, 0); }
          90% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, 4px); }
        }
      `}</style>
    </div>
  );
};

/**
 * Ambient Pill - Minimal HUD displaying call stats
 * Stays visible at all times, no gaze divergence (h = 3.2mm, θ < 0.33°)
 */
export const AmbientPill: React.FC<{ talkTime: number; commitments: number }> = ({
  talkTime,
  commitments,
}) => {
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-2 py-1 text-xs text-neutral-400 font-mono bg-neutral-900/40 backdrop-blur-sm rounded-full border border-neutral-700/50 z-40">
      <span>🟢 {talkTime}% Talk</span>
      <span>⚡ {commitments} Commitments</span>
    </div>
  );
};
