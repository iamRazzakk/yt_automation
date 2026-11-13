"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

export default function ClipReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const yt = useQuery({ queryKey: ["yt"], queryFn: api.youtubeStatus });
  const clipQ = useQuery({
    queryKey: ["clip", id],
    queryFn: () => api.clip(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "UPLOADING" || s === "PUBLISH_QUEUED" || s === "RENDERING"
        ? 2000
        : 15000;
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("public");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!clipQ.data) return;
    setTitle(clipQ.data.ytTitle);
    setDescription(clipQ.data.ytDescription);
    setTags(clipQ.data.ytTags.join(", "));
    setPrivacy(clipQ.data.ytPrivacy as "private" | "unlisted" | "public");
  }, [clipQ.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patchClip(id, {
        ytTitle: title,
        ytDescription: description,
        ytTags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ytPrivacy: privacy,
      }),
    onSuccess: () => {
      setMsg("Saved");
      qc.invalidateQueries({ queryKey: ["clip", id] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const approve = useMutation({
    mutationFn: () => api.approveClip(id),
    onSuccess: () => {
      setMsg("Publish queued");
      qc.invalidateQueries({ queryKey: ["clip", id] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const reject = useMutation({
    mutationFn: () => api.rejectClip(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clip", id] }),
  });

  const regen = useMutation({
    mutationFn: () => api.regenerateMetadata(id),
    onSuccess: (c) => {
      setTitle(c.ytTitle);
      setDescription(c.ytDescription);
      setTags(c.ytTags.join(", "));
      qc.invalidateQueries({ queryKey: ["clip", id] });
    },
  });

  if (clipQ.isLoading) return <p className="text-mist">Loading…</p>;
  if (!clipQ.data) return <p className="text-danger">Clip not found</p>;
  const c = clipQ.data;
  const canEdit = c.status === "READY" || c.status === "PUBLISH_FAILED";
  const canApprove = canEdit && yt.data?.connected && !yt.data.needsReconnect;
  const approveReason = !yt.data?.connected
    ? "Connect YouTube in Settings"
    : yt.data.needsReconnect
      ? "Reconnect YouTube"
      : !canEdit
        ? `Status is ${c.status}`
        : null;

  return (
    <section className="grid gap-6 md:gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
      <div>
        <Link href={`/videos/${c.videoId}`} className="text-sm text-mist no-underline">
          ← Back to video
        </Link>
        <div className="mx-auto mt-3 aspect-[9/16] max-h-[70vh] w-full max-w-sm overflow-hidden border border-line bg-black sm:max-w-none">
          {c.videoKey ? (
            <video
              key={c.id}
              src={`/api/clips/${c.id}/video`}
              controls
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-mist">
              Video not ready
            </div>
          )}
        </div>
        <div className="mt-3">
          <StatusBadge status={c.status} />
        </div>
        {c.ytVideoId && (
          <a
            className="mt-3 inline-block text-sm"
            href={
              c.ytVideoId.startsWith("dryrun_")
                ? undefined
                : `https://youtu.be/${c.ytVideoId}`
            }
            target="_blank"
            rel="noreferrer"
          >
            {c.ytVideoId.startsWith("dryrun_")
              ? `Dry-run id: ${c.ytVideoId}`
              : "Open on YouTube"}
          </a>
        )}
      </div>

      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Review clip</h1>

        {c.titleOptions?.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-mist">Title options</p>
            <div className="flex flex-col gap-2">
              {c.titleOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setTitle(t)}
                  className={`border px-3 py-2 text-left text-sm ${
                    title === t ? "border-accent text-accent" : "border-line text-foam"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block text-sm text-mist">
          Title ({title.length}/100)
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            className="mt-1 w-full border border-line bg-panel px-3 py-2 text-foam"
          />
        </label>

        {c.publishAt && c.status === "READY" && (
          <p className="rounded border border-line bg-panel/40 px-3 py-2 text-sm text-mist">
            Scheduled upload:{" "}
            <span className="text-foam">{new Date(c.publishAt).toLocaleString()}</span>
            {" · "}privacy public (auto). Manual Approve publishes now.
          </p>
        )}

        <label className="block text-sm text-mist">
          Description ({description.length}/4500)
          <textarea
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value.slice(0, 4500))}
            rows={10}
            className="mt-1 w-full border border-line bg-panel px-3 py-2 text-foam"
          />
        </label>

        <label className="block text-sm text-mist">
          Tags (comma separated)
          <input
            value={tags}
            disabled={!canEdit}
            onChange={(e) => setTags(e.target.value)}
            className="mt-1 w-full border border-line bg-panel px-3 py-2 text-foam"
          />
        </label>

        <label className="block text-sm text-mist">
          Privacy
          <select
            value={privacy}
            disabled={!canEdit}
            onChange={(e) =>
              setPrivacy(e.target.value as "private" | "unlisted" | "public")
            }
            className="mt-1 w-full border border-line bg-panel px-3 py-2 text-foam"
          >
            <option value="private">private</option>
            <option value="unlisted">unlisted</option>
            <option value="public">public</option>
          </select>
        </label>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={!canEdit || save.isPending}
            onClick={() => save.mutate()}
            className="border border-line px-3 py-2.5 text-sm sm:py-2"
          >
            Save
          </button>
          <button
            type="button"
            disabled={!canEdit || regen.isPending}
            onClick={() => regen.mutate()}
            className="border border-line px-3 py-2.5 text-sm sm:py-2"
          >
            Regenerate metadata
          </button>
          <button
            type="button"
            disabled={!canApprove || approve.isPending}
            title={approveReason ?? undefined}
            onClick={() => approve.mutate()}
            className="bg-accent px-3 py-2.5 text-sm font-medium text-ink disabled:opacity-40 sm:py-2"
          >
            Approve & Publish
          </button>
          <button
            type="button"
            disabled={!canEdit || reject.isPending}
            onClick={() => reject.mutate()}
            className="border border-danger/40 px-3 py-2.5 text-sm text-danger sm:py-2"
          >
            Reject
          </button>
        </div>
        {approveReason && canEdit && (
          <p className="text-sm text-warn">{approveReason}</p>
        )}
        {msg && <p className="text-sm text-mist">{msg}</p>}
        {c.errorMessage && <p className="text-sm text-danger">{c.errorMessage}</p>}
      </div>
    </section>
  );
}
