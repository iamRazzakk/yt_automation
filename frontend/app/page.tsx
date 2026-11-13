"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

const ACTIVE = new Set([
  "QUEUED",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "RENDERING",
]);

export default function VideosPage() {
  const videos = useQuery({
    queryKey: ["videos"],
    queryFn: api.videos,
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      return items.some((v) => ACTIVE.has(v.status)) ? 2000 : 15000;
    },
  });

  return (
    <section>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold sm:text-2xl">Videos</h1>
        <Link
          href="/new"
          className="shrink-0 bg-accent px-3 py-2 text-sm font-medium text-ink no-underline sm:px-4"
        >
          New video
        </Link>
      </div>

      {videos.isLoading && <p className="text-mist">Loading…</p>}
      {videos.error && (
        <p className="text-danger">{(videos.error as Error).message}</p>
      )}

      <ul className="space-y-3">
        {(videos.data?.items ?? []).map((v) => (
          <li key={v.id}>
            <Link
              href={`/videos/${v.id}`}
              className="flex flex-col gap-3 border border-line bg-panel/60 px-3 py-3 no-underline transition hover:border-accent/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foam">
                  {v.title ?? "Untitled video"}
                </p>
                <p className="mt-1 text-xs text-mist">
                  {new Date(v.createdAt).toLocaleString()}
                </p>
                {ACTIVE.has(v.status) && (
                  <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden bg-line">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${v.progress}%` }}
                    />
                  </div>
                )}
                {v.errorMessage && (
                  <p className="mt-1 truncate text-xs text-danger">{v.errorMessage}</p>
                )}
              </div>
              <div className="self-start sm:self-center">
                <StatusBadge status={v.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {videos.data?.items.length === 0 && (
        <p className="border border-dashed border-line px-4 py-10 text-center text-mist">
          No videos yet.{" "}
          <Link href="/new" className="text-accent">
            Submit one
          </Link>
          .
        </p>
      )}
    </section>
  );
}
