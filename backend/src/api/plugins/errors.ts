import type { FastifyInstance, FastifyError } from "fastify";
import { AppError } from "../../domain/errors.js";

export async function errorPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (err instanceof AppError) {
      const status =
        err.code === "DISK_LOW"
          ? 507
          : err.category === "USER_INPUT"
            ? 400
            : 500;
      return reply.status(status).send({
        error: { code: err.code, message: err.message },
      });
    }

    const anyErr = err as FastifyError & { code?: string; statusCode?: number };
    if (anyErr.statusCode === 409 || anyErr.code === "INVALID_TRANSITION") {
      return reply.status(409).send({
        error: {
          code: "INVALID_TRANSITION",
          message: anyErr.message,
        },
      });
    }

    if (anyErr.statusCode === 401) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    if (anyErr.statusCode === 429) {
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      });
    }

    app.log.error({ err }, "unhandled error");
    return reply.status(anyErr.statusCode ?? 500).send({
      error: {
        code: "INTERNAL",
        message: anyErr.message || "Internal server error",
      },
    });
  });
}
