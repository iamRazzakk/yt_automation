import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat as fsStat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { StorageProvider, StorageStat } from "./provider.js";

function assertSafeKey(key: string): void {
  if (!key || key.includes("\0")) {
    throw new Error("Invalid storage key");
  }
  if (key.includes("..") || isAbsolute(key) || key.startsWith("/") || key.startsWith("\\")) {
    throw new Error("Invalid storage key");
  }
  if (key.split(/[/\\]/).some((p) => p === "..")) {
    throw new Error("Invalid storage key");
  }
}

export class LocalStorage implements StorageProvider {
  constructor(private readonly root: string) {
    if (!root) throw new Error("STORAGE_ROOT is required");
  }

  localPath(key: string): string {
    assertSafeKey(key);
    const rootResolved = resolve(this.root);
    const full = resolve(join(rootResolved, key));
    const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
    if (full !== rootResolved && !full.startsWith(prefix)) {
      throw new Error("Invalid storage key: path escapes root");
    }
    return full;
  }

  async put(key: string, source: Readable | string): Promise<void> {
    const dest = this.localPath(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    try {
      if (typeof source === "string") {
        const srcPath = source;
        await pipeline(createReadStream(srcPath), createWriteStream(tmp));
      } else {
        await pipeline(source, createWriteStream(tmp));
      }
      const handle = await open(tmp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, dest);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async getStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<Readable> {
    const path = this.localPath(key);
    if (!existsSync(path)) {
      throw new Error(`Object not found: ${key}`);
    }
    if (range) {
      return createReadStream(path, {
        start: range.start,
        end: range.end,
      });
    }
    return createReadStream(path);
  }

  async stat(key: string): Promise<StorageStat | null> {
    try {
      const path = this.localPath(key);
      const s = await fsStat(path);
      if (!s.isFile()) return null;
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.localPath(key);
    await rm(path, { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix.replace(/\/$/, "") || "x");
    const dir = this.localPath(prefix.replace(/\/$/, ""));
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    // If prefix points at a directory, remove it entirely
    const s = await fsStat(dir);
    if (s.isDirectory()) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    for (const entry of entries) {
      await rm(join(dir, entry.name), { recursive: true, force: true });
    }
  }
}

let storage: LocalStorage | null = null;

export function getStorage(root?: string): LocalStorage {
  if (!storage) {
    if (!root) throw new Error("Storage not initialized");
    storage = new LocalStorage(root);
  }
  return storage;
}

export function initStorage(root: string): LocalStorage {
  storage = new LocalStorage(root);
  return storage;
}
