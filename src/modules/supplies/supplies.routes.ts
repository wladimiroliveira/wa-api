import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createSupplySchema, updateSupplySchema, supplyIdParamSchema } from "./supplies.schema.js";
import * as repo from "./supplies.repository.js";

export default async function supplyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/supplies", async () => repo.listSupplies());

  r.post("/supplies", { schema: { body: createSupplySchema } }, async (req, reply) => {
    const supply = await repo.createSupply(req.body);
    return reply.status(201).send(supply);
  });

  r.get("/supplies/:id", { schema: { params: supplyIdParamSchema } }, async (req, reply) => {
    const supply = await repo.getSupply(req.params.id);
    if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
    return supply;
  });

  r.patch("/supplies/:id", { schema: { params: supplyIdParamSchema, body: updateSupplySchema } }, async (req) =>
    repo.updateSupply(req.params.id, req.body),
  );

  r.delete("/supplies/:id", { schema: { params: supplyIdParamSchema } }, async (req, reply) => {
    await repo.deleteSupply(req.params.id);
    return reply.status(204).send();
  });
}
