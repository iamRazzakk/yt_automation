"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

const STAGES = [
  "QUEUED",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "RENDERING",
  "READY",
];

const ACTIVE = new Set([
  "QUEUED",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "RENDERING",
]);

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const video = useQuery({
    queryKey: ["video", id],
    queryFn: () => api.video(id),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 2000 : 15000),
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelVideo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video", id] }),
  });
  const retry = useMutation({
    mutationFn: () => api.retryVideo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video", id] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteVideo(id),
    onSuccess: () => router.push("/"),
  });

  if (video.isLoading) return <p className="text-mist">Loading…</p>;
  if (video.error || !video.data) {
    return <p className="text-danger">{(video.error as Error)?.message ?? "Not found"}</p>;
  }

  const v = video.data;
  const stageIdx = STAGES.indexOf(v.status === "FAILED" || v.status === "CANCELLED" ? "READY" : v.status);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            {v.title ?? "Untitled video"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusBadge status={v.status} />
            <span className="text-sm text-mist">{v.stageDetail}</span>
          </div>
          {v.errorMessage && (
            <p className="mt-2 text-sm text-danger">
              {v.errorCode}: {v.errorMessage}
              {v.errorCode === "DOWNLOAD_BLOCKED" &&
                " — upload the file instead or add a cookies file."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIVE.has(v.status) && (
            <button
              onClick={() => cancel.mutate()}
              className="border border-line px-3 py-1.5 text-sm text-mist"
            >
              Cancel
            </button>
          )}
          {v.status === "FAILED" && (
            <button
              onClick={() => retry.mutate()}
              className="border border-warn/40 px-3 py-1.5 text-sm text-warn"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => {
              if (confirm("Delete this video and its files?")) del.mutate();
            }}
            className="border border-danger/40 px-3 py-1.5 text-sm text-danger"
          >
            Delete
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-mist">Pipeline</p>
        <ol className="flex flex-wrap gap-2">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={`rounded px-2 py-1 text-xs ${
                i <= stageIdx && v.status !== "FAILED" && v.status !== "CANCELLED"
                  ? "bg-accent/20 text-accent"
                  : "bg-line/60 text-mist"
              }`}
            >
              {s}
            </li>
          ))}
        </ol>
        {ACTIVE.has(v.status) && (
          <div className="mt-3 h-2 w-full max-w-md overflow-hidden bg-line">
            <div className="h-full bg-accent" style={{ width: `${v.progress}%` }} />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg">Clips</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {v.clips.map((c) => (
            <Link
              key={c.id}
              href={`/clips/${c.id}`}
              className="border border-line bg-panel/50 p-3 no-underline hover:border-accent/40"
            >
              <div className="mb-2 aspect-[9/16] max-h-48 overflow-hidden bg-ink">
                {c.thumbKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/clips/${c.id}/thumbnail`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-mist">
                    No thumb
                  </div>
                )}
              </div>
              <p className="line-clamp-2 text-sm text-foam">{c.ytTitle}</p>
              <div className="mt-2">
                <StatusBadge status={c.status} />
              </div>
            </Link>
          ))}
        </div>
        {v.clips.length === 0 && (
          <p className="text-sm text-mist">Clips appear after analysis.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg">Event log</h2>
        <ul className="max-h-80 space-y-2 overflow-auto border border-line bg-panel/40 p-3 text-sm">
          {v.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="shrink-0 text-xs text-mist">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <span
                className={
                  e.level === "error"
                    ? "text-danger"
                    : e.level === "warn"
                      ? "text-warn"
                      : "text-foam"
                }
              >
                {e.stage ? `[${e.stage}] ` : ""}
                {e.message}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
