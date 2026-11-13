import type { Sentence } from "./sentences.js";

export interface Candidate {
  start: number;
  end: number;
  text: string;
  sentenceStart: number;
  sentenceEnd: number;
}

export interface CandidateOptions {
  clipMinSec: number;
  clipMaxSec: number;
  mediaDuration: number;
  targetSec?: number;
}

export function generateCandidates(
  sentences: Sentence[],
  opts: CandidateOptions,
): Candidate[] {
  const target = opts.targetSec ?? 45;
  const out: Candidate[] = [];
  let lastAcceptedStart = -Infinity;

  for (let i = 0; i < sentences.length; i++) {
    const startSentence = sentences[i]!;
    if (startSentence.start - lastAcceptedStart < 4) continue;

    let bestJ: number | null = null;
    let bestDist = Infinity;

    for (let j = i; j < sentences.length; j++) {
      const endSentence = sentences[j]!;
      const duration = endSentence.end - startSentence.start;
      if (duration > opts.clipMaxSec) break;
      if (duration >= opts.clipMinSec) {
        const dist = Math.abs(duration - target);
        if (dist < bestDist) {
          bestDist = dist;
          bestJ = j;
        }
      }
    }

    if (bestJ === null) continue;

    let start = startSentence.start - 0.25;
    let end = sentences[bestJ]!.end + 0.35;
    start = Math.max(0, start);
    end = Math.min(opts.mediaDuration, end);
    if (end - start > 59) {
      end = start + 59;
    }
    if (end - start < opts.clipMinSec) continue;

    const text = sentences
      .slice(i, bestJ + 1)
      .map((s) => s.text)
      .join(" ");

    out.push({
      start,
      end,
      text,
      sentenceStart: i,
      sentenceEnd: bestJ,
    });
    lastAcceptedStart = startSentence.start;
  }

  return out;
}
