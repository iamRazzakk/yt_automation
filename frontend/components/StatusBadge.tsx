const COLORS: Record<string, string> = {
  QUEUED: "bg-line text-mist",
  DOWNLOADING: "bg-sky-500/20 text-sky-300",
  TRANSCRIBING: "bg-violet-500/20 text-violet-300",
  ANALYZING: "bg-fuchsia-500/20 text-fuchsia-300",
  RENDERING: "bg-amber-500/20 text-amber-300",
  READY: "bg-accent/20 text-accent",
  FAILED: "bg-danger/20 text-danger",
  CANCELLED: "bg-line text-mist",
  APPROVED: "bg-accent/20 text-accent",
  PUBLISHED: "bg-accent/30 text-accent",
  REJECTED: "bg-danger/15 text-danger",
  PUBLISH_FAILED: "bg-warn/20 text-warn",
  UPLOADING: "bg-sky-500/20 text-sky-300",
  PUBLISH_QUEUED: "bg-sky-500/15 text-sky-200",
  RENDER_FAILED: "bg-danger/20 text-danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${
        COLORS[status] ?? "bg-line text-mist"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
