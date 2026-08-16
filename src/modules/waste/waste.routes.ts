import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createWasteSchema, supplyIdParamSchema, wasteQuerySchema, wastePageResponseSchema } from "./waste.schema.js";
import { createWaste, listWastes } from "./waste.service.js";
import { SupplyNotFoundError } from "../stock/stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, protectedErrors } from "../shared/response.js";
import { stockEntryResponseSchema } from "../stock/stock.schema.js";

export default async function wasteRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/wastes",
    {
      preHandler: requirePermission(Permission.WASTE_WRITE),
      schema: {
        params: supplyIdParamSchema,
        body: createWasteSchema,
        response: { 201: stockEntryResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      try {
        const result = await createWaste(req.params.id, req.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof SupplyNotFoundError) return reply.status(404).send({ message: err.message });
        if (err instanceof DimensionMismatchError)
          return reply.status(400).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  r.get(
    "/wastes",
    {
      preHandler: requirePermission(Permission.WASTE_READ),
      schema: {
        querystring: wasteQuerySchema,
        response: { 200: wastePageResponseSchema, 400: errorSchema, ...protectedErrors },
      },
    },
    async (req) => listWastes(req.query),
  );
}
