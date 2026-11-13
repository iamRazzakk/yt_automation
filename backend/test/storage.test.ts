import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../src/infra/storage/local.js";

describe("LocalStorage", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    root = await mkdtemp(join(tmpdir(), "ss-storage-"));
    return new LocalStorage(root);
  }

  it("puts and stats a file from a stream", async () => {
    const storage = await setup();
    await storage.put("videos/v1/original.mp4", Readable.from(["hello-world"]));
    const s = await storage.stat("videos/v1/original.mp4");
    expect(s?.size).toBe(11);
    const stream = await storage.getStream("videos/v1/original.mp4");
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("hello-world");
  });

  it("puts from a local path", async () => {
    const storage = await setup();
    const src = join(root, "src.bin");
    await writeFile(src, "abc");
    await storage.put("clips/c1.mp4", src);
    const dest = storage.localPath("clips/c1.mp4");
    expect(await readFile(dest, "utf8")).toBe("abc");
  });

  it("rejects path traversal keys", async () => {
    const storage = await setup();
    expect(() => storage.localPath("../etc/passwd")).toThrow(/Invalid storage key/);
    expect(() => storage.localPath("videos/../../etc/passwd")).toThrow(/Invalid storage key/);
    expect(() => storage.localPath("/absolute")).toThrow(/Invalid storage key/);
  });

  it("deletes a key and prefix", async () => {
    const storage = await setup();
    await storage.put("tmp/job1/a.txt", Readable.from(["x"]));
    await storage.put("tmp/job1/b.txt", Readable.from(["y"]));
    await storage.delete("tmp/job1/a.txt");
    expect(await storage.stat("tmp/job1/a.txt")).toBeNull();
    await storage.deletePrefix("tmp/job1");
    expect(await storage.stat("tmp/job1/b.txt")).toBeNull();
  });

  it("supports range reads", async () => {
    const storage = await setup();
    await mkdir(join(root, "videos"), { recursive: true });
    await storage.put("videos/range.bin", Readable.from(["0123456789"]));
    const stream = await storage.getStream("videos/range.bin", { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("2345");
  });
});
