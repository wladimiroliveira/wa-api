import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pingDatabase } from "./health.repository.js";
import { healthResponseSchema } from "./health.schema.js";

export default async function healthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/health",
    {
      config: { public: true },
      schema: { security: [], response: { 200: healthResponseSchema, 503: healthResponseSchema } },
    },
    async (req, reply) => {
      try {
        await pingDatabase();
        return { status: "ok", database: "up" } as const;
      } catch (err) {
        req.log.error(err);
        return reply.status(503).send({ status: "error", database: "down" } as const);
      }
    },
  );
}
