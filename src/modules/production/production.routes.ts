import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createProductionSchema, productionIdParamSchema } from "./production.schema.js";
import { registerProduction, RecipeNotFoundError } from "./production.service.js";
import { listProductions, getProduction } from "./production.repository.js";

export default async function productionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post("/productions", { schema: { body: createProductionSchema } }, async (req, reply) => {
    try {
      const result = await registerProduction(req.body);
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) return reply.status(404).send({ code: err.code, message: err.message });
      throw err;
    }
  });

  r.get("/productions", async () => listProductions());

  r.get("/productions/:id", { schema: { params: productionIdParamSchema } }, async (req, reply) => {
    const production = await getProduction(req.params.id);
    if (!production) return reply.status(404).send({ message: "Produção não encontrada" });
    return production;
  });
}
