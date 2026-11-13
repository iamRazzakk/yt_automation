import type { Readable } from "node:stream";

export interface StorageStat {
  size: number;
}

export interface StorageProvider {
  put(key: string, source: Readable | string): Promise<void>;
  getStream(key: string, range?: { start: number; end?: number }): Promise<Readable>;
  stat(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  localPath(key: string): string;
}
