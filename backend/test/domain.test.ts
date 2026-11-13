import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/domain/candidates.js";
import { buildAssCaptions } from "../src/domain/captions-ass.js";
import { buildAudioFilter, buildRenderArgs } from "../src/domain/ffmpeg-args.js";
import { generateFallbackMetadata, sanitizeMetadata } from "../src/domain/metadata-sanitize.js";
import { scoreCandidates } from "../src/domain/scoring.js";
import { selectNonOverlapping } from "../src/domain/select.js";
import { buildSentences } from "../src/domain/sentences.js";

describe("sentences", () => {
  it("splits on punctuation and gaps", () => {
    const words = [
      { w: "Hello", start: 0, end: 0.3 },
      { w: "world.", start: 0.35, end: 0.7 },
      { w: "Why", start: 2.0, end: 2.2 },
      { w: "now?", start: 2.3, end: 2.6 },
    ];
    const s = buildSentences(words);
    expect(s.length).toBe(2);
    expect(s[0]?.text).toContain("Hello");
    expect(s[1]?.text).toContain("Why");
  });
});

describe("candidates + scoring + select", () => {
  it("builds non-overlapping clips near target length", () => {
    const words = [];
    for (let i = 0; i < 400; i++) {
      const start = i * 0.4;
      words.push({
        w: i % 20 === 19 ? `word${i}.` : `word${i}`,
        start,
        end: start + 0.3,
      });
    }
    const sentences = buildSentences(words);
    const candidates = generateCandidates(sentences, {
      clipMinSec: 30,
      clipMaxSec: 55,
      mediaDuration: 160,
    });
    expect(candidates.length).toBeGreaterThan(0);
    const lexicon = {
      hookPatterns: ["why", "secret"],
      stopwords: ["the", "a"],
    };
    const energy = {
      hop: 1,
      rms: Array.from({ length: 160 }, (_, i) => 0.02 + (i % 5) * 0.01),
    };
    const scored = scoreCandidates(candidates, sentences, energy, lexicon);
    const selected = selectNonOverlapping(
      scored.map((c) => ({ ...c, score: c.heuristicScore })),
      3,
    );
    expect(selected.length).toBeGreaterThan(0);
    for (const c of selected) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(30);
      expect(c.end - c.start).toBeLessThanOrEqual(59);
    }
  });
});

describe("metadata-sanitize", () => {
  it("enforces limits and strips forbidden chars", () => {
    const out = sanitizeMetadata({
      titles: ["<Bad> title " + "x".repeat(100), "ok"],
      description: "hello <script>",
      tags: ["One", "one", "a".repeat(40), ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
      hook: "hook",
    });
    expect(out.titles[0]!.length).toBeLessThanOrEqual(70);
    expect(out.titles[0]).not.toContain("<");
    expect(out.description).toMatch(/#Shorts/);
    expect(out.tags.length).toBeLessThanOrEqual(15);
    expect(out.tags.join(",").length).toBeLessThanOrEqual(450);
  });

  it("builds fallback metadata", () => {
    const m = generateFallbackMetadata("Why most people fail. Here is the secret. Keep going.");
    expect(m.titles[0]).toBeTruthy();
    expect(m.tags.length).toBeGreaterThanOrEqual(8);
  });

  it("forces English-only titles tags and description", () => {
    const out = sanitizeMetadata({
      titles: ["বাংলা টাইটেল", "English title only"],
      description: "মজার ক্লিপ funny clip",
      tags: ["বাংলা", "shorts", "viral"],
      hook: "হুক hook line",
    });
    expect(out.titles.every((t) => !/[^\x00-\x7F]/.test(t))).toBe(true);
    expect(out.titles.some((t) => /English/i.test(t))).toBe(true);
    expect(out.description).not.toMatch(/[\u0980-\u09FF]/);
    expect(out.tags.every((t) => /^[a-z0-9 -]+$/.test(t))).toBe(true);
    expect(out.hook).not.toMatch(/[\u0980-\u09FF]/);
  });
});

describe("captions-ass", () => {
  it("emits a valid ASS header and dialogue", () => {
    const ass = buildAssCaptions(
      [
        { w: "Hello", start: 10, end: 10.3 },
        { w: "world", start: 10.4, end: 10.7 },
        { w: "today", start: 10.8, end: 11.1 },
        { w: "friends", start: 11.2, end: 11.5 },
      ],
      10,
      20,
      { width: 1080, height: 1920 },
      {
        font: "Inter",
        fontSize: 64,
        bold: true,
        primaryColor: "#FFFFFF",
        outlineColor: "#000000",
        outline: 4,
        x: 540,
        y: 1640,
        alignment: 2,
        maxCharsPerLine: 26,
        maxLines: 2,
        wordsPerChunk: 4,
      },
    );
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue:");
  });
});

describe("ffmpeg-args", () => {
  it("snapshots args array", () => {
    const args = buildRenderArgs({
      start: 12.5,
      end: 52.5,
      preset: "veryfast",
      fontsDir: "fonts",
      layout: {
        id: "default",
        canvas: { width: 1080, height: 1920 },
        background: { type: "blur", color: "#000000" },
        slot: { x: 0, y: 420, width: 1080, height: 1080, fit: "cover" },
        overlay: "overlay.png",
        caption: {
          font: "Inter",
          fontSize: 64,
          bold: true,
          primaryColor: "#FFFFFF",
          outlineColor: "#000000",
          outline: 4,
          x: 540,
          y: 1640,
          alignment: 2,
          maxCharsPerLine: 26,
          maxLines: 2,
          wordsPerChunk: 4,
        },
        thumbnail: {
          width: 1080,
          height: 1920,
          overlay: "thumb_overlay.png",
          titleBox: { x: 60, y: 1300, width: 960, height: 400, fontSize: 88 },
        },
      },
    });
    expect(args).toMatchSnapshot();
    expect(args.includes("libx264")).toBe(true);
    expect(args.includes("pipe:1")).toBe(true);
    expect(args).toContain(buildAudioFilter());
    expect(buildAudioFilter()).toMatch(/volume='1\+0\.1\*sin\(2\*PI\*t\/4\.5\)':eval=frame/);
  });
});
