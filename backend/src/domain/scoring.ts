import type { Candidate } from "./candidates.js";
import type { Sentence } from "./sentences.js";

export interface Lexicon {
  hookPatterns: string[];
  stopwords: string[];
}

export interface ScoreWeights {
  hook: number;
  energy: number;
  rate: number;
  density: number;
  silence: number;
  closure: number;
}

/** Bias toward peak energy / “most replayed” style moments in the long video. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  hook: 0.2,
  energy: 0.35,
  rate: 0.12,
  density: 0.15,
  silence: -0.12,
  closure: 0.1,
};

export interface ScoredCandidate extends Candidate {
  heuristicScore: number;
  features: Record<string, number>;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function minMax(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return values.map(() => 0.5);
  return values.map((v) => (v - lo) / (hi - lo));
}

export function scoreCandidates(
  candidates: Candidate[],
  sentences: Sentence[],
  energy: { hop: number; rms: number[] },
  lexicon: Lexicon,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ScoredCandidate[] {
  const stop = new Set(lexicon.stopwords.map((s) => s.toLowerCase()));
  const hookRes = lexicon.hookPatterns.map(
    (p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
  );

  const raw = candidates.map((c) => {
    const first = sentences[c.sentenceStart];
    const last = sentences[c.sentenceEnd];
    const firstText = first?.text ?? "";
    const isQuestion = firstText.trim().endsWith("?");
    const hasHookWord = hookRes.some((re) => re.test(firstText));
    const hasNumber = /\d/.test(firstText);
    const hook = isQuestion || hasHookWord || hasNumber ? 1 : 0;

    const i0 = Math.floor(c.start / energy.hop);
    const i1 = Math.ceil(c.end / energy.hop);
    const window = energy.rms.slice(i0, i1);
    // Peak loudness + variation ≈ moments people rewatch / lean in.
    const peak = window.length ? Math.max(...window) : 0;
    const energyFeature = peak * 0.6 + stddev(window) * 0.25 + mean(window) * 0.15;

    const words = c.text.split(/\s+/).filter(Boolean);
    const duration = Math.max(0.1, c.end - c.start);
    const wps = words.length / duration;
    const rate =
      wps >= 2.5 && wps <= 3.2
        ? 1
        : wps < 2.5
          ? Math.max(0, 1 - (2.5 - wps) / 2.5)
          : Math.max(0, 1 - (wps - 3.2) / 3.2);

    const content = words.filter((w) => !stop.has(w.toLowerCase()));
    const density = words.length === 0 ? 0 : content.length / words.length;

    const silenceThresh = 0.01;
    const silence =
      window.length === 0
        ? 0
        : window.filter((v) => v < silenceThresh).length / window.length;

    const closure = /[.?!…।]$/.test((last?.text ?? "").trim()) ? 1 : 0;

    return {
      candidate: c,
      features: { hook, energy: energyFeature, rate, density, silence, closure },
    };
  });

  const keys = ["hook", "energy", "rate", "density", "silence", "closure"] as const;
  const norm: Record<(typeof keys)[number], number[]> = {
    hook: [],
    energy: [],
    rate: [],
    density: [],
    silence: [],
    closure: [],
  };
  for (const k of keys) {
    norm[k] = minMax(raw.map((r) => r.features[k]));
  }

  return raw.map((r, idx) => {
    const f = {
      hook: norm.hook[idx]!,
      energy: norm.energy[idx]!,
      rate: norm.rate[idx]!,
      density: norm.density[idx]!,
      silence: norm.silence[idx]!,
      closure: norm.closure[idx]!,
    };
    const score =
      weights.hook * f.hook +
      weights.energy * f.energy +
      weights.rate * f.rate +
      weights.density * f.density +
      weights.silence * f.silence +
      weights.closure * f.closure;
    const heuristicScore = Math.min(1, Math.max(0, score));
    return {
      ...r.candidate,
      heuristicScore,
      features: f,
    };
  });
}
