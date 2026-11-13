import type { Word } from "./sentences.js";

export interface CaptionStyle {
  font: string;
  fontSize: number;
  bold: boolean;
  primaryColor: string;
  outlineColor: string;
  outline: number;
  x: number;
  y: number;
  alignment: number;
  maxCharsPerLine: number;
  maxLines: number;
  wordsPerChunk: number;
}

export interface CaptionCanvas {
  width: number;
  height: number;
}

function assColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function chunkWords(
  words: Word[],
  wordsPerChunk: number,
  maxCharsPerLine: number,
  maxLines: number,
): { start: number; end: number; text: string }[] {
  const chunks: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const group = words.slice(i, i + wordsPerChunk);
    const lines: string[] = [];
    let line = "";
    for (const w of group) {
      const next = line ? `${line} ${w.w}` : w.w;
      if (next.length > maxCharsPerLine && line) {
        lines.push(line);
        line = w.w;
        if (lines.length >= maxLines) break;
      } else {
        line = next;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    chunks.push({
      start: group[0]!.start,
      end: group[group.length - 1]!.end,
      text: lines.join("\\N"),
    });
  }
  return chunks;
}

export function buildAssCaptions(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  canvas: CaptionCanvas,
  style: CaptionStyle,
): string {
  const inRange = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      ...w,
      start: Math.max(0, w.start - clipStart),
      end: Math.max(0, Math.min(clipEnd, w.end) - clipStart),
    }));

  const chunks = chunkWords(
    inRange,
    style.wordsPerChunk,
    style.maxCharsPerLine,
    style.maxLines,
  );

  for (let i = 0; i < chunks.length - 1; i++) {
    const cur = chunks[i]!;
    const next = chunks[i + 1]!;
    if (next.start - cur.end < 0.15) {
      cur.end = next.start;
    }
  }

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${canvas.width}
PlayResY: ${canvas.height}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font},${style.fontSize},${assColor(style.primaryColor)},${assColor(style.primaryColor)},${assColor(style.outlineColor)},&H80000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outline},0,${style.alignment},40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = chunks
    .map(
      (c) =>
        `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},Default,,0,0,0,,${escapeAss(c.text)}`,
    )
    .join("\n");

  return header + events + "\n";
}
