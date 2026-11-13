import type { ClipStatus, VideoStatus } from "@prisma/client";

const videoTransitions: Record<VideoStatus, readonly VideoStatus[]> = {
  QUEUED: ["DOWNLOADING", "CANCELLED", "FAILED"],
  DOWNLOADING: ["TRANSCRIBING", "FAILED", "CANCELLED"],
  TRANSCRIBING: ["ANALYZING", "FAILED", "CANCELLED"],
  ANALYZING: ["RENDERING", "FAILED", "CANCELLED"],
  RENDERING: ["READY", "FAILED", "CANCELLED"],
  READY: ["CANCELLED"],
  FAILED: ["QUEUED", "DOWNLOADING", "TRANSCRIBING", "ANALYZING", "RENDERING"],
  CANCELLED: [],
};

const clipTransitions: Record<ClipStatus, readonly ClipStatus[]> = {
  RENDERING: ["READY", "RENDER_FAILED"],
  READY: ["APPROVED", "REJECTED"],
  REJECTED: [],
  APPROVED: ["PUBLISH_QUEUED"],
  PUBLISH_QUEUED: ["UPLOADING"],
  UPLOADING: ["PUBLISHED", "PUBLISH_FAILED"],
  PUBLISHED: [],
  PUBLISH_FAILED: ["APPROVED", "READY"],
  RENDER_FAILED: ["RENDERING"],
};

export function canTransitionVideo(from: VideoStatus, to: VideoStatus): boolean {
  return videoTransitions[from].includes(to);
}

export function canTransitionClip(from: ClipStatus, to: ClipStatus): boolean {
  return clipTransitions[from].includes(to);
}

export function assertVideoTransition(from: VideoStatus, to: VideoStatus): void {
  if (!canTransitionVideo(from, to)) {
    throw Object.assign(new Error(`Invalid video transition ${from} -> ${to}`), {
      code: "INVALID_TRANSITION",
      statusCode: 409,
    });
  }
}

export function assertClipTransition(from: ClipStatus, to: ClipStatus): void {
  if (!canTransitionClip(from, to)) {
    throw Object.assign(new Error(`Invalid clip transition ${from} -> ${to}`), {
      code: "INVALID_TRANSITION",
      statusCode: 409,
    });
  }
}
