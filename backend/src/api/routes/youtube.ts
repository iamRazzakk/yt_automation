import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { loadConfig } from "../../infra/config.js";
import { encryptToken, signSession, verifySession } from "../../infra/crypto.js";
import { getDb } from "../../infra/db.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function oauthClient() {
  const cfg = loadConfig();
  return new google.auth.OAuth2(
    cfg.GOOGLE_CLIENT_ID,
    cfg.GOOGLE_CLIENT_SECRET,
    cfg.GOOGLE_REDIRECT_URI,
  );
}

export async function youtubeRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.get("/api/youtube/status", async () => {
    const account = await db.youtubeAccount.findUnique({ where: { id: 1 } });
    if (!account) {
      return { connected: false };
    }
    return {
      connected: true,
      channelId: account.channelId,
      channelTitle: account.channelTitle,
      needsReconnect: account.needsReconnect,
      connectedAt: account.connectedAt,
    };
  });

  app.get("/api/youtube/connect", async (_req, reply) => {
    const cfg = loadConfig();
    if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) {
      return reply.status(400).send({
        error: {
          code: "YT_NOT_CONFIGURED",
          message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
        },
      });
    }
    const state = randomBytes(16).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    const stateToken = signSession(
      { iat: now, exp: now + 600 },
      cfg.SESSION_SECRET + state,
    );
    reply.setCookie("oauth_state", `${state}|${stateToken}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    const client = oauthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
    });
    return reply.redirect(url);
  });

  app.get("/api/youtube/callback", async (req, reply) => {
    const cfg = loadConfig();
    const query = req.query as { code?: string; state?: string; error?: string };
    if (query.error) {
      return reply.redirect(`${cfg.APP_URL}/settings?yt=error`);
    }
    const cookie = req.cookies.oauth_state;
    if (!cookie || !query.state || !query.code) {
      return reply.redirect(`${cfg.APP_URL}/settings?yt=bad_state`);
    }
    const sep = cookie.indexOf("|");
    const state = sep >= 0 ? cookie.slice(0, sep) : "";
    const stateToken = sep >= 0 ? cookie.slice(sep + 1) : "";
    if (state !== query.state || !stateToken) {
      return reply.redirect(`${cfg.APP_URL}/settings?yt=bad_state`);
    }
    const ok = verifySession(stateToken, cfg.SESSION_SECRET + state);
    if (!ok) {
      return reply.redirect(`${cfg.APP_URL}/settings?yt=bad_state`);
    }

    const client = oauthClient();
    const { tokens } = await client.getToken(query.code);
    if (!tokens.refresh_token) {
      return reply.redirect(`${cfg.APP_URL}/settings?yt=no_refresh`);
    }
    client.setCredentials(tokens);
    const yt = google.youtube({ version: "v3", auth: client });
    const channels = await yt.channels.list({ part: ["snippet"], mine: true });
    const ch = channels.data.items?.[0];
    const enc = encryptToken(tokens.refresh_token, cfg.TOKEN_ENCRYPTION_KEY);

    await db.youtubeAccount.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        channelId: ch?.id ?? null,
        channelTitle: ch?.snippet?.title ?? null,
        refreshTokenEnc: enc,
        scopes: SCOPES.join(" "),
        needsReconnect: false,
        connectedAt: new Date(),
      },
      update: {
        channelId: ch?.id ?? null,
        channelTitle: ch?.snippet?.title ?? null,
        refreshTokenEnc: enc,
        scopes: SCOPES.join(" "),
        needsReconnect: false,
        connectedAt: new Date(),
      },
    });

    reply.clearCookie("oauth_state", { path: "/" });
    return reply.redirect(`${cfg.APP_URL}/settings?yt=connected`);
  });

  app.delete("/api/youtube", async () => {
    await db.youtubeAccount.deleteMany({ where: { id: 1 } });
    return { ok: true };
  });
}
