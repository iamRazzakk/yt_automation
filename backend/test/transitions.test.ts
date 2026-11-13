import { describe, expect, it } from "vitest";
import {
  canTransitionClip,
  canTransitionVideo,
} from "../src/domain/transitions.js";

describe("canTransition", () => {
  it("allows valid video pipeline transitions", () => {
    expect(canTransitionVideo("QUEUED", "DOWNLOADING")).toBe(true);
    expect(canTransitionVideo("DOWNLOADING", "TRANSCRIBING")).toBe(true);
    expect(canTransitionVideo("RENDERING", "READY")).toBe(true);
    expect(canTransitionVideo("READY", "DOWNLOADING")).toBe(false);
    expect(canTransitionVideo("CANCELLED", "QUEUED")).toBe(false);
  });

  it("allows valid clip transitions", () => {
    expect(canTransitionClip("READY", "APPROVED")).toBe(true);
    expect(canTransitionClip("READY", "REJECTED")).toBe(true);
    expect(canTransitionClip("APPROVED", "PUBLISH_QUEUED")).toBe(true);
    expect(canTransitionClip("PUBLISHED", "READY")).toBe(false);
  });
});
