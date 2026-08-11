import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createStockEntrySchema, supplyIdParamSchema } from "./stock.schema.js";
import { createStockEntry, SupplyNotFoundError } from "./stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";
import { listMovements } from "./stock.repository.js";
import { getSupply } from "../supplies/supplies.repository.js";

export default async function stockRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/stock-entries",
    { schema: { params: supplyIdParamSchema, body: createStockEntrySchema } },
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

  r.get("/supplies/:id/movements", { schema: { params: supplyIdParamSchema } }, async (req, reply) => {
    const supply = await getSupply(req.params.id);
    if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
    return listMovements(req.params.id);
  });
}
