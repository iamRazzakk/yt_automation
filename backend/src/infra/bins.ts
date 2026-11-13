import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

const cache = new Map<string, string>();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a CLI binary for spawn() without shell.
 * On Windows, bare names like "yt-dlp" often ENOENT; prefer ".exe".
 */
export async function resolveBin(
  name: string,
  envKey?: string,
): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  if (envKey) {
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv && (await exists(fromEnv))) {
      cache.set(name, fromEnv);
      return fromEnv;
    }
  }

  const isWin = process.platform === "win32";
  const candidates = isWin
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
    : [name];

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of pathDirs) {
    for (const file of candidates) {
      const full = join(dir, file);
      if (await exists(full)) {
        cache.set(name, full);
        return full;
      }
    }
  }

  // Last resort: return the bare name (lets spawn try PATH again)
  cache.set(name, isWin ? `${name}.exe` : name);
  return cache.get(name)!;
}

export async function resolveYtDlp(): Promise<{ cmd: string; prefixArgs: string[] }> {
  const fromEnv = process.env.YTDLP_PATH?.trim();
  if (fromEnv && (await exists(fromEnv))) {
    return { cmd: fromEnv, prefixArgs: [] };
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  const names =
    process.platform === "win32"
      ? ["yt-dlp.exe", "yt-dlp.cmd", "yt-dlp.bat"]
      : ["yt-dlp"];
  for (const dir of pathDirs) {
    for (const file of names) {
      const full = join(dir, file);
      if (await exists(full)) {
        return { cmd: full, prefixArgs: [] };
      }
    }
  }

  // Fallback: python -m yt_dlp (works after `pip install yt-dlp`)
  const py = await resolveBin("python", "PYTHON_PATH");
  return { cmd: py, prefixArgs: ["-m", "yt_dlp"] };
}
