import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    isAuthenticated: boolean;
  }
}

/** Auth gate disabled — dashboard is open (no admin password). */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("isAuthenticated", false);

  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api")) return;
    req.isAuthenticated = true;
  });
}
