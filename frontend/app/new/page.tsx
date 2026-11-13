"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

export default function NewVideoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: api.systemStats,
    refetchInterval: 15000,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "youtube") {
        const res = await api.createVideo(url, templateId);
        if (res.duplicateOf) {
          // still proceed; hint only
        }
        router.push(`/videos/${res.id}`);
      } else {
        if (!file) throw new Error("Choose a file");
        const res = await api.uploadVideo(file);
        router.push(`/videos/${res.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold">New video</h1>
      <p className="mt-1 text-sm text-mist">
        Free disk: {stats.data ? `${stats.data.disk.freeGb.toFixed(1)} GB` : "…"}
        {stats.data?.disk.blocked && (
          <span className="ml-2 text-danger"> — blocked: {stats.data.disk.reason}</span>
        )}
      </p>

      <div className="mt-6 flex gap-2 border-b border-line">
        {(["youtube", "upload"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${
              tab === t ? "border-b-2 border-accent text-accent" : "text-mist"
            }`}
          >
            {t === "youtube" ? "YouTube link" : "Upload file"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {tab === "youtube" ? (
          <label className="block text-sm text-mist">
            URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="YouTube link (watch, youtu.be, Shorts…)"
              className="mt-2 w-full border border-line bg-panel px-3 py-2 text-foam"
              required
            />
          </label>
        ) : (
          <label className="block text-sm text-mist">
            File
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-foam"
              required
            />
          </label>
        )}

        <label className="block text-sm text-mist">
          Template
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-2 w-full border border-line bg-panel px-3 py-2 text-foam"
          >
            {(templates.data?.items ?? [{ id: "default" }]).map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || stats.data?.disk.blocked}
          className="bg-accent px-4 py-2.5 font-medium text-ink disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Start pipeline"}
        </button>
      </form>
    </section>
  );
}
