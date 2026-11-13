export interface Word {
  w: string;
  start: number;
  end: number;
  p?: number;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
  wordRange: [number, number];
}

const TERMINAL = /[.?!…।]$/;

export function buildSentences(words: Word[]): Sentence[] {
  if (words.length === 0) return [];

  const sentences: Sentence[] = [];
  let startIdx = 0;

  const flush = (endIdx: number) => {
    const slice = words.slice(startIdx, endIdx + 1);
    if (slice.length === 0) return;
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    sentences.push({
      start: first.start,
      end: last.end,
      text: slice.map((w) => w.w).join(" ").replace(/\s+/g, " ").trim(),
      wordRange: [startIdx, endIdx],
    });
    startIdx = endIdx + 1;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    const terminal = TERMINAL.test(word.w.trim());
    const gapBreak = next !== undefined && next.start - word.end > 0.8;
    if (terminal || gapBreak || i === words.length - 1) {
      flush(i);
    }
  }

  // Force-split sentences longer than 25 s
  const result: Sentence[] = [];
  for (const s of sentences) {
    if (s.end - s.start <= 25) {
      result.push(s);
      continue;
    }
    result.push(...splitLongSentence(words, s));
  }
  return result;
}

function splitLongSentence(words: Word[], s: Sentence): Sentence[] {
  const [from, to] = s.wordRange;
  const out: Sentence[] = [];
  let start = from;

  while (start <= to) {
    let end = start;
    let bestSplit = start;
    let bestGap = -1;
    while (end <= to && words[end]!.end - words[start]!.start <= 25) {
      if (end > start) {
        const gap = words[end]!.start - words[end - 1]!.end;
        if (gap >= bestGap) {
          bestGap = gap;
          bestSplit = end - 1;
        }
      }
      end++;
    }
    const splitAt =
      end <= to && bestSplit >= start ? bestSplit : Math.min(end - 1, to);
    const slice = words.slice(start, splitAt + 1);
    out.push({
      start: slice[0]!.start,
      end: slice[slice.length - 1]!.end,
      text: slice.map((w) => w.w).join(" ").replace(/\s+/g, " ").trim(),
      wordRange: [start, splitAt],
    });
    start = splitAt + 1;
  }
  return out;
}
