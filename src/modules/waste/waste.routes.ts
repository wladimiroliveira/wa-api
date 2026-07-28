import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createWasteSchema, supplyIdParamSchema } from "./waste.schema.js";
import { createWaste, listWastes } from "./waste.service.js";
import { SupplyNotFoundError } from "../stock/stock.service.js";
import { DimensionMismatchError } from "../shared/dimension.js";

export default async function wasteRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/supplies/:id/wastes",
    { schema: { params: supplyIdParamSchema, body: createWasteSchema } },
    async (req, reply) => {
      try {
        const result = await createWaste(req.params.id, req.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof SupplyNotFoundError) return reply.status(404).send({ message: err.message });
        if (err instanceof DimensionMismatchError) return reply.status(400).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  r.get("/wastes", async () => listWastes());
}
