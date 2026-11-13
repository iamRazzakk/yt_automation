import { statfs } from "node:fs/promises";
import { loadConfig } from "./config.js";

export interface DiskStatus {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPct: number;
  freeGb: number;
  blocked: boolean;
  reason?: string;
}

export async function getDiskStatus(root?: string): Promise<DiskStatus> {
  const cfg = loadConfig();
  const path = root ?? cfg.STORAGE_ROOT;
  const stats = await statfs(path);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const usedBytes = totalBytes - freeBytes;
  const usedPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 100;
  const freeGb = freeBytes / (1024 * 1024 * 1024);

  let blocked = false;
  let reason: string | undefined;
  if (usedPct >= cfg.DISK_BLOCK_NEW_JOBS_PCT) {
    blocked = true;
    reason = `Disk usage ${usedPct.toFixed(1)}% >= ${cfg.DISK_BLOCK_NEW_JOBS_PCT}%`;
  } else if (freeGb < cfg.MIN_FREE_GB) {
    blocked = true;
    reason = `Free space ${freeGb.toFixed(2)} GB < ${cfg.MIN_FREE_GB} GB`;
  }

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPct,
    freeGb,
    blocked,
    ...(reason !== undefined ? { reason } : {}),
  };
}

export async function assertDiskAllowsNewJobs(): Promise<void> {
  const status = await getDiskStatus();
  if (status.blocked) {
    const err = new Error(status.reason ?? "Disk space too low");
    (err as Error & { code: string }).code = "DISK_LOW";
    throw err;
  }
}

export async function assertFreeSpaceForDownload(
  expectedBytes: number,
): Promise<void> {
  const cfg = loadConfig();
  const status = await getDiskStatus();
  const needed = expectedBytes * cfg.DOWNLOAD_SPACE_MULTIPLIER;
  if (status.freeBytes < needed) {
    const err = new Error(
      `Need ${(needed / 1e9).toFixed(2)} GB free for download, have ${status.freeGb.toFixed(2)} GB`,
    );
    (err as Error & { code: string }).code = "DISK_LOW";
    throw err;
  }
}
