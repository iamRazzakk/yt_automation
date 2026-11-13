const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_RE = /^[\w-]{11}$/;

/** Trim, accept http, strip share/tracking junk, keep a parseable YouTube URL. */
export function cleanYoutubeInput(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (s.startsWith("http://")) s = `https://${s.slice(7)}`;
  // Bare youtu.be/ID or youtube.com/... without scheme
  if (!/^https?:\/\//i.test(s) && /^(www\.)?(youtu\.be|youtube\.com|m\.youtube\.com)\b/i.test(s)) {
    s = `https://${s}`;
  }
  return s;
}

export function isAllowedYoutubeUrl(raw: string): boolean {
  return normalizeYoutubeUrl(raw) !== null;
}

export function extractYoutubeId(raw: string): string | null {
  const normalized = normalizeYoutubeUrl(raw);
  if (!normalized) return null;
  try {
    return new URL(normalized).searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Canonical watch URL: https://www.youtube.com/watch?v=VIDEO_ID
 * Accepts watch / youtu.be / shorts / embed / live / v / with ?si= etc.
 */
export function normalizeYoutubeUrl(raw: string): string | null {
  try {
    const u = new URL(cleanYoutubeInput(raw));
    if (u.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null;

    let id: string | null = null;
    const host = u.hostname.toLowerCase();

    if (host === "youtu.be" || host === "www.youtu.be") {
      id = u.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (u.pathname === "/watch" || u.pathname === "/watch/") {
      id = u.searchParams.get("v");
    } else {
      const parts = u.pathname.split("/").filter(Boolean);
      const kind = parts[0];
      if (
        kind === "shorts" ||
        kind === "embed" ||
        kind === "live" ||
        kind === "v" ||
        kind === "e"
      ) {
        id = parts[1] ?? null;
      } else if (u.searchParams.get("v")) {
        id = u.searchParams.get("v");
      }
    }

    // youtu.be sometimes puts id in query as fallback
    if (!id) id = u.searchParams.get("v");
    if (!id) return null;
    // Drop accidental ?si= glued into path fragments
    id = id.split("?")[0]!.split("&")[0]!;
    if (!VIDEO_ID_RE.test(id)) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}
