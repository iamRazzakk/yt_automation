export type ApiError = { error: { code: string; message: string } };

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T | ApiError;
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  me: () => fetch("/api/auth/me", { credentials: "include" }).then((r) => r.ok),
  login: (password: string) =>
    fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(parse<{ ok: boolean }>),
  logout: () =>
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(
      parse<{ ok: boolean }>,
    ),
  videos: () =>
    fetch("/api/videos", { credentials: "include" }).then(
      parse<{ items: Video[]; total: number }>,
    ),
  video: (id: string) =>
    fetch(`/api/videos/${id}`, { credentials: "include" }).then(parse<VideoDetail>),
  createVideo: (url: string, templateId?: string) =>
    fetch("/api/videos", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, templateId }),
    }).then(parse<{ id: string; duplicateOf?: string }>),
  uploadVideo: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/videos/upload", {
      method: "POST",
      credentials: "include",
      body: fd,
    }).then(parse<{ id: string }>);
  },
  cancelVideo: (id: string) =>
    fetch(`/api/videos/${id}/cancel`, { method: "POST", credentials: "include" }).then(
      parse<unknown>,
    ),
  retryVideo: (id: string) =>
    fetch(`/api/videos/${id}/retry`, { method: "POST", credentials: "include" }).then(
      parse<unknown>,
    ),
  deleteVideo: (id: string) =>
    fetch(`/api/videos/${id}`, { method: "DELETE", credentials: "include" }).then(
      parse<{ ok: boolean }>,
    ),
  clip: (id: string) =>
    fetch(`/api/clips/${id}`, { credentials: "include" }).then(parse<Clip>),
  patchClip: (id: string, body: Partial<ClipPatch>) =>
    fetch(`/api/clips/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(parse<Clip>),
  approveClip: (id: string) =>
    fetch(`/api/clips/${id}/approve`, { method: "POST", credentials: "include" }).then(
      parse<{ ok: boolean }>,
    ),
  rejectClip: (id: string) =>
    fetch(`/api/clips/${id}/reject`, { method: "POST", credentials: "include" }).then(
      parse<Clip>,
    ),
  regenerateMetadata: (id: string) =>
    fetch(`/api/clips/${id}/regenerate-metadata`, {
      method: "POST",
      credentials: "include",
    }).then(parse<Clip>),
  youtubeStatus: () =>
    fetch("/api/youtube/status", { credentials: "include" }).then(parse<YtStatus>),
  disconnectYoutube: () =>
    fetch("/api/youtube", { method: "DELETE", credentials: "include" }).then(
      parse<{ ok: boolean }>,
    ),
  publishSchedule: () =>
    fetch("/api/settings/publish-schedule", { credentials: "include" }).then(
      parse<PublishScheduleResponse>,
    ),
  savePublishSchedule: (body: PublishSchedule) =>
    fetch("/api/settings/publish-schedule", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(parse<PublishScheduleResponse>),
  systemStats: () =>
    fetch("/api/system/stats", { credentials: "include" }).then(parse<SystemStats>),
  templates: () =>
    fetch("/api/templates", { credentials: "include" }).then(
      parse<{ items: Array<{ id: string }> }>,
    ),
};

export interface Video {
  id: string;
  title: string | null;
  status: string;
  progress: number;
  createdAt: string;
  errorMessage?: string | null;
  clips?: Array<{ id: string; thumbKey: string | null }>;
}

export interface VideoDetail extends Video {
  stageDetail: string | null;
  sourceUrl: string | null;
  sourceType: string;
  durationSec: number | null;
  errorCode: string | null;
  clips: Clip[];
  events: Array<{
    id: string;
    level: string;
    message: string;
    stage: string | null;
    createdAt: string;
  }>;
}

export interface Clip {
  id: string;
  videoId: string;
  idx: number;
  startSec: number;
  endSec: number;
  status: string;
  titleOptions: string[];
  ytTitle: string;
  ytDescription: string;
  ytTags: string[];
  ytPrivacy: string;
  hookText: string | null;
  ytVideoId: string | null;
  publishAt: string | null;
  videoKey: string | null;
  thumbKey: string | null;
  errorMessage: string | null;
  video?: { id: string; title: string | null; status: string };
}

export interface PublishSchedule {
  enabled: boolean;
  intervalHours: number;
  startAt: string | null;
}

export interface PublishScheduleResponse {
  schedule: PublishSchedule;
  upcoming: Array<{
    id: string;
    ytTitle: string;
    publishAt: string | null;
    ytPrivacy: string;
    videoId: string;
  }>;
}

export interface ClipPatch {
  ytTitle: string;
  ytDescription: string;
  ytTags: string[];
  ytPrivacy: "private" | "unlisted" | "public";
}

export interface YtStatus {
  connected: boolean;
  channelTitle?: string | null;
  needsReconnect?: boolean;
}

export interface SystemStats {
  disk: {
    usedPct: number;
    freeGb: number;
    blocked: boolean;
    reason?: string;
  };
  queues: Record<string, number>;
  ollama: { ok: boolean; hasModel: boolean };
  failureRate: { d7: number; d30: number };
}
