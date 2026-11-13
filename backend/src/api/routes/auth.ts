import type { FastifyInstance } from "fastify";

/** Password login removed — endpoints kept as no-ops for old clients. */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async () => {
    return { ok: true };
  });

  app.post("/api/auth/logout", async () => {
    return { ok: true };
  });

  app.get("/api/auth/me", async () => {
    return { authenticated: true };
  });
}
