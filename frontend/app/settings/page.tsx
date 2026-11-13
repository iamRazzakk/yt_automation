"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const yt = useQuery({ queryKey: ["yt"], queryFn: api.youtubeStatus });
  const schedQ = useQuery({
    queryKey: ["publish-schedule"],
    queryFn: api.publishSchedule,
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectYoutube,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt"] }),
  });

  const [enabled, setEnabled] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!schedQ.data) return;
    setEnabled(schedQ.data.schedule.enabled);
    setStartLocal(toLocalInput(schedQ.data.schedule.startAt));
  }, [schedQ.data]);

  const saveSched = useMutation({
    mutationFn: () =>
      api.savePublishSchedule({
        enabled,
        intervalHours: 1,
        startAt: fromLocalInput(startLocal),
      }),
    onSuccess: () => {
      setMsg("Schedule saved — READY clips slotted hourly from start time");
      qc.invalidateQueries({ queryKey: ["publish-schedule"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>

      <div className="border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
        Uploads may be forced private until your Google Cloud API project is audited by
        YouTube. Default privacy is <strong>public</strong>.
      </div>

      <div className="border border-line bg-panel/50 p-4">
        <h2 className="font-medium">YouTube</h2>
        {yt.isLoading && <p className="mt-2 text-sm text-mist">Loading…</p>}
        {yt.data?.connected ? (
          <div className="mt-3 space-y-2 text-sm">
            <p>
              Connected: <span className="text-foam">{yt.data.channelTitle}</span>
            </p>
            {yt.data.needsReconnect && (
              <p className="text-danger">Reconnect required (token expired).</p>
            )}
            <div className="flex gap-2 pt-2">
              <a
                href="/api/youtube/connect"
                className="border border-line px-3 py-1.5 no-underline"
              >
                Reconnect
              </a>
              <button
                type="button"
                onClick={() => disconnect.mutate()}
                className="border border-danger/40 px-3 py-1.5 text-danger"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-mist">Not connected.</p>
            <a
              href="/api/youtube/connect"
              className="mt-3 inline-block bg-accent px-3 py-2 text-sm font-medium text-ink no-underline"
            >
              Connect YouTube
            </a>
          </div>
        )}
      </div>

      <div className="border border-line bg-panel/50 p-4 space-y-3">
        <h2 className="font-medium">Auto publish schedule</h2>
        <p className="text-sm text-mist">
          Uploads <strong className="text-foam">1 public Short per hour</strong>, starting
          from the date/time you pick (e.g. 2–3 days later). Clips stay READY until their
          slot.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable hourly auto-upload
        </label>
        <label className="block text-sm text-mist">
          First upload at
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className="mt-1 w-full border border-line bg-panel px-3 py-2 text-foam"
          />
        </label>
        <p className="text-xs text-mist">Interval: every 1 hour · Privacy: public</p>
        <button
          type="button"
          disabled={saveSched.isPending || (enabled && !startLocal)}
          onClick={() => saveSched.mutate()}
          className="bg-accent px-3 py-2 text-sm font-medium text-ink disabled:opacity-40"
        >
          Save schedule
        </button>
        {msg && <p className="text-sm text-mist">{msg}</p>}

        {schedQ.data?.upcoming && schedQ.data.upcoming.length > 0 && (
          <div className="pt-2">
            <p className="mb-2 text-xs uppercase tracking-wide text-mist">Upcoming slots</p>
            <ul className="space-y-1 text-sm">
              {schedQ.data.upcoming.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 border-b border-line/50 py-1">
                  <Link href={`/clips/${c.id}`} className="truncate text-foam no-underline">
                    {c.ytTitle}
                  </Link>
                  <span className="shrink-0 text-mist">
                    {c.publishAt ? new Date(c.publishAt).toLocaleString() : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
