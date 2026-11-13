import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loadConfig } from "../../infra/config.js";
import { verifySession } from "../../infra/crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    isAuthenticated: boolean;
  }
}

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/youtube/callback",
]);

export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("isAuthenticated", false);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api")) return;
    const path = req.url.split("?")[0] ?? req.url;
    if (PUBLIC_PATHS.has(path)) return;

    const cfg = loadConfig();
    const token = req.cookies.session;
    if (!token) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }
    const session = verifySession(token, cfg.SESSION_SECRET);
    if (!session) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Invalid or expired session" },
      });
    }
    req.isAuthenticated = true;
  });
}
