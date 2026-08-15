import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createProductionSchema,
  productionIdParamSchema,
  productionDetailResponseSchema,
  productionListResponseSchema,
  registerProductionResponseSchema,
} from "./production.schema.js";
import { registerProduction, RecipeNotFoundError } from "./production.service.js";
import { listProductions, getProduction } from "./production.repository.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, protectedErrors } from "../shared/response.js";

export default async function productionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/productions",
    {
      preHandler: requirePermission(Permission.PRODUCTION_WRITE),
      schema: {
        body: createProductionSchema,
        response: { 201: registerProductionResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      try {
        const result = await registerProduction(req.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof RecipeNotFoundError) return reply.status(404).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  r.get(
    "/productions",
    {
      preHandler: requirePermission(Permission.PRODUCTION_READ),
      schema: { response: { 200: productionListResponseSchema, ...protectedErrors } },
    },
    async () => listProductions(),
  );

  r.get(
    "/productions/:id",
    {
      preHandler: requirePermission(Permission.PRODUCTION_READ),
      schema: {
        params: productionIdParamSchema,
        response: { 200: productionDetailResponseSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const production = await getProduction(req.params.id);
      if (!production) return reply.status(404).send({ message: "Produção não encontrada" });
      return production;
    },
  );
}
