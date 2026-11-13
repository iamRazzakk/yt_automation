"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function SystemPage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: api.systemStats,
    refetchInterval: 5000,
  });

  if (stats.isLoading) return <p className="text-mist">Loading…</p>;
  if (!stats.data) return <p className="text-danger">Failed to load stats</p>;
  const s = stats.data;

  return (
    <section className="space-y-8">
      <h1 className="font-display text-2xl font-semibold">System</h1>

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-mist">Disk</h2>
        <div className="h-3 w-full max-w-lg overflow-hidden bg-line">
          <div
            className={`h-full ${s.disk.blocked ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${Math.min(100, s.disk.usedPct)}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-mist">
          {s.disk.usedPct.toFixed(1)}% used · {s.disk.freeGb.toFixed(1)} GB free
          {s.disk.blocked && ` · BLOCKED: ${s.disk.reason}`}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-mist">Queues</h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {Object.entries(s.queues).map(([name, n]) => (
            <li key={name} className="border border-line bg-panel/40 px-3 py-2 text-sm">
              <span className="text-mist">{name}</span>
              <span className="ml-2 font-medium">{n}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-mist">Ollama</h2>
        <p className="text-sm">
          {s.ollama.ok ? "Reachable" : "Down / unreachable"}
          {s.ollama.hasModel ? " · model present" : " · model missing"}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-mist">Failure rate (SYSTEM)</h2>
        <p className="text-sm">
          7d: {(s.failureRate.d7 * 100).toFixed(1)}% · 30d:{" "}
          {(s.failureRate.d30 * 100).toFixed(1)}%
        </p>
      </div>
    </section>
  );
}
