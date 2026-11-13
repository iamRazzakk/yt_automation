import { describe, expect, it } from "vitest";
import {
  extractYoutubeId,
  normalizeYoutubeUrl,
} from "../src/infra/ytdlp.js";

describe("normalizeYoutubeUrl", () => {
  const id = "tiMHtc6l7xM";
  const canonical = `https://www.youtube.com/watch?v=${id}`;

  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&feature=share`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=cfIguQaMcK1uguWy`,
    ` https://youtu.be/${id}?si=abc `,
    `http://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `youtu.be/${id}?si=xyz`,
  ])("normalizes %s", (raw) => {
    expect(normalizeYoutubeUrl(raw)).toBe(canonical);
    expect(extractYoutubeId(raw)).toBe(id);
  });

  it("rejects non-youtube hosts", () => {
    expect(normalizeYoutubeUrl("https://vimeo.com/123")).toBeNull();
  });
});
