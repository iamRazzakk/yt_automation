import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { google } from "googleapis";
import { ErrorCatalog, makeError } from "../domain/errors.js";
import { loadConfig } from "../infra/config.js";
import { decryptToken } from "../infra/crypto.js";
import { getDb } from "../infra/db.js";
import { createLogger } from "../infra/logger.js";
import { getStorage } from "../infra/storage/local.js";

const log = createLogger("worker-publish");
const CHUNK = 8 * 1024 * 1024;

export async function processPublish(job: {
  data: { clipId: string };
}): Promise<void> {
  const { clipId } = job.data;
  const cfg = loadConfig();
  const db = getDb();
  const storage = getStorage(cfg.STORAGE_ROOT);

  const clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) throw new UnrecoverableError("Clip not found");
  if (clip.status === "PUBLISHED" && clip.ytVideoId) return;
  if (!clip.videoKey) throw new UnrecoverableError("Missing clip file");

  const account = await db.youtubeAccount.findUnique({ where: { id: 1 } });
  if (!account || account.needsReconnect) {
    throw makeError(ErrorCatalog.YT_AUTH_EXPIRED, "YouTube account needs reconnect");
  }

  if (cfg.YT_DRY_RUN) {
    const dryDir = storage.localPath("dryrun");
    await mkdir(dryDir, { recursive: true });
    const payload = {
      snippet: {
        title: clip.ytTitle,
        description: clip.ytDescription,
        tags: clip.ytTags,
        categoryId: cfg.YT_DEFAULT_CATEGORY_ID,
      },
      status: {
        privacyStatus: clip.ytPrivacy,
        selfDeclaredMadeForKids: false,
      },
    };
    await writeFile(
      join(dryDir, `${clipId}.json`),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    await db.clip.update({
      where: { id: clipId },
      data: {
        status: "PUBLISHED",
        ytVideoId: `dryrun_${clipId}`,
        publishedAt: new Date(),
      },
    });
    return;
  }

  await db.clip.update({
    where: { id: clipId },
    data: { status: "UPLOADING" },
  });

  try {
    const client = new google.auth.OAuth2(
      cfg.GOOGLE_CLIENT_ID,
      cfg.GOOGLE_CLIENT_SECRET,
      cfg.GOOGLE_REDIRECT_URI,
    );
    const refresh = decryptToken(account.refreshTokenEnc, cfg.TOKEN_ENCRYPTION_KEY);
    client.setCredentials({ refresh_token: refresh });

    const st = await storage.stat(clip.videoKey);
    if (!st) throw new UnrecoverableError("Clip file missing on disk");
    const filePath = storage.localPath(clip.videoKey);

    let sessionUrl = clip.ytUploadSessionUrl;
    if (!sessionUrl) {
      const init = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await getAccessToken(client)}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": String(st.size),
          },
          body: JSON.stringify({
            snippet: {
              title: clip.ytTitle,
              description: clip.ytDescription,
              tags: clip.ytTags,
              categoryId: cfg.YT_DEFAULT_CATEGORY_ID,
            },
            status: {
              privacyStatus: clip.ytPrivacy,
              selfDeclaredMadeForKids: false,
            },
          }),
        },
      );
      if (!init.ok) {
        await mapYtError(init, account.id);
      }
      sessionUrl = init.headers.get("location");
      if (!sessionUrl) throw makeError(ErrorCatalog.YT_NETWORK, "No upload session URL");
      await db.clip.update({
        where: { id: clipId },
        data: { ytUploadSessionUrl: sessionUrl },
      });
    }

    let offset = await queryOffset(sessionUrl, st.size);
    const stream = createReadStream(filePath, { start: offset });
    // Upload remaining in one PUT with Content-Range (simplified chunked loop)
    while (offset < st.size) {
      const end = Math.min(offset + CHUNK, st.size) - 1;
      const chunkStream = createReadStream(filePath, { start: offset, end });
      const chunks: Buffer[] = [];
      for await (const c of chunkStream) chunks.push(Buffer.from(c));
      const buf = Buffer.concat(chunks);
      const res = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(buf.length),
          "Content-Range": `bytes ${offset}-${end}/${st.size}`,
          "Content-Type": "video/mp4",
        },
        body: buf,
      });
      if (res.status === 308) {
        const range = res.headers.get("range");
        if (range) {
          const m = /bytes=0-(\d+)/.exec(range);
          offset = m ? Number(m[1]) + 1 : end + 1;
        } else {
          offset = end + 1;
        }
        continue;
      }
      if (!res.ok) {
        await mapYtError(res, account.id);
      }
      const body = (await res.json()) as { id?: string };
      await db.clip.update({
        where: { id: clipId },
        data: {
          status: "PUBLISHED",
          ytVideoId: body.id ?? null,
          publishedAt: new Date(),
          ytUploadSessionUrl: null,
        },
      });

      if (clip.thumbKey && body.id) {
        try {
          const yt = google.youtube({ version: "v3", auth: client });
          await yt.thumbnails.set({
            videoId: body.id,
            media: {
              mimeType: "image/jpeg",
              body: createReadStream(storage.localPath(clip.thumbKey)),
            },
          });
        } catch (e) {
          await db.clip.update({
            where: { id: clipId },
            data: { ytThumbError: e instanceof Error ? e.message : "thumb failed" },
          });
        }
      }
      void stream;
      return;
    }
  } catch (e) {
    await fail(clipId, e, account.id);
    if (e && typeof e === "object" && "retryable" in e && !(e as { retryable: boolean }).retryable) {
      const msg = e instanceof Error ? e.message : "Unrecoverable publish error";
      throw new UnrecoverableError(msg);
    }
    throw e;
  }
}

async function getAccessToken(
  client: InstanceType<typeof google.auth.OAuth2>,
): Promise<string> {
  const tok = await client.getAccessToken();
  if (!tok.token) throw makeError(ErrorCatalog.YT_AUTH_EXPIRED, "No access token");
  return tok.token;
}

async function queryOffset(sessionUrl: string, total: number): Promise<number> {
  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Length": "0",
      "Content-Range": `bytes */${total}`,
    },
  });
  if (res.status === 200 || res.status === 201) {
    return total;
  }
  if (res.status === 308) {
    const range = res.headers.get("range");
    if (!range) return 0;
    const m = /bytes=0-(\d+)/.exec(range);
    return m ? Number(m[1]) + 1 : 0;
  }
  return 0;
}

async function mapYtError(res: Response, accountId: number): Promise<never> {
  const db = getDb();
  const text = await res.text();
  if (res.status === 401 || text.includes("invalid_grant")) {
    await db.youtubeAccount.update({
      where: { id: accountId },
      data: { needsReconnect: true },
    });
    throw makeError(ErrorCatalog.YT_AUTH_EXPIRED, "YouTube auth expired");
  }
  if (text.includes("quotaExceeded")) {
    throw makeError(ErrorCatalog.YT_QUOTA, "Daily API quota reached, try tomorrow.");
  }
  if (text.includes("uploadLimitExceeded")) {
    throw makeError(ErrorCatalog.YT_UPLOAD_LIMIT, "Channel daily upload limit reached");
  }
  if (res.status >= 500) {
    throw makeError(ErrorCatalog.YT_NETWORK, `YouTube 5xx: ${text.slice(0, 200)}`);
  }
  throw makeError(ErrorCatalog.YT_REJECTED, text.slice(0, 300));
}

async function fail(clipId: string, e: unknown, _accountId: number): Promise<void> {
  const db = getDb();
  const err = e as { code?: string; message?: string };
  log.error({ clipId, err: e }, "publish failed");
  await db.clip.update({
    where: { id: clipId },
    data: {
      status: "PUBLISH_FAILED",
      errorCode: err.code ?? "YT_NETWORK",
      errorMessage: err.message ?? "Publish failed",
    },
  });
}
