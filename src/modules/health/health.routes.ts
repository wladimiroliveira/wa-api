import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pingDatabase } from "./health.repository.js";

export default async function healthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/health", { config: { public: true }, schema: { security: [] } }, async (req, reply) => {
    try {
      await pingDatabase();
      return { status: "ok", database: "up" };
    } catch (err) {
      req.log.error(err);
      return reply.status(503).send({ status: "error", database: "down" });
    }
  });
}
