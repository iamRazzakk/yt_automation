import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../../infra/config.js";
import { constantTimeEqual, signSession } from "../../infra/crypto.js";

const loginBody = z.object({
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
  }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const cfg = loadConfig();
    if (!constantTimeEqual(body.password, cfg.ADMIN_PASSWORD)) {
      return reply.status(401).send({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid password" },
      });
    }
    const now = Math.floor(Date.now() / 1000);
    const token = signSession(
      { iat: now, exp: now + 7 * 24 * 3600 },
      cfg.SESSION_SECRET,
    );
    reply.setCookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: cfg.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async () => {
    return { authenticated: true };
  });
}
