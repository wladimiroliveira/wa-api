import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createStockEntrySchema,
  supplyIdParamSchema,
  stockEntryResponseSchema,
  movementPageQuerySchema,
  stockMovementPageResponseSchema,
} from "./stock.schema.js";
import { createStockEntry, SupplyNotFoundError } from "./stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";
import { listMovements } from "./stock.repository.js";
import { getSupply } from "../supplies/supplies.repository.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, protectedErrors } from "../shared/response.js";

export default async function stockRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/stock-entries",
    {
      preHandler: requirePermission(Permission.STOCK_WRITE),
      schema: {
        params: supplyIdParamSchema,
        body: createStockEntrySchema,
        response: { 201: stockEntryResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      try {
        const result = await createStockEntry(req.params.id, req.body);
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
    "/supplies/:id/movements",
    {
      preHandler: requirePermission(Permission.STOCK_READ),
      schema: {
        params: supplyIdParamSchema,
        querystring: movementPageQuerySchema,
        response: { 200: stockMovementPageResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const supply = await getSupply(req.params.id);
      if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
      return listMovements(req.params.id, req.query);
    },
  );
}
