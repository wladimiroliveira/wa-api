import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createSupplySchema,
  updateSupplySchema,
  supplyIdParamSchema,
  supplyListResponseSchema,
  supplyResponseSchema,
} from "./supplies.schema.js";
import * as repo from "./supplies.repository.js";
import { requirePermission } from "../auth/auth.guard.js";
import { Permission } from "../../generated/prisma/index.js";
import { errorSchema, noContentSchema, protectedErrors } from "../shared/response.js";

export default async function supplyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/supplies",
    {
      preHandler: requirePermission(Permission.SUPPLIES_READ),
      schema: { response: { 200: supplyListResponseSchema, ...protectedErrors } },
    },
    async () => repo.listSupplies(),
  );

  r.post(
    "/supplies",
    {
      preHandler: requirePermission(Permission.SUPPLIES_WRITE),
      schema: {
        body: createSupplySchema,
        response: { 201: supplyResponseSchema, 400: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const supply = await repo.createSupply(req.body);
      return reply.status(201).send(supply);
    },
  );

  r.get(
    "/supplies/:id",
    {
      preHandler: requirePermission(Permission.SUPPLIES_READ),
      schema: {
        params: supplyIdParamSchema,
        response: { 200: supplyResponseSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      const supply = await repo.getSupply(req.params.id);
      if (!supply) return reply.status(404).send({ message: "Insumo não encontrado" });
      return supply;
    },
  );

  r.patch(
    "/supplies/:id",
    {
      preHandler: requirePermission(Permission.SUPPLIES_WRITE),
      schema: {
        params: supplyIdParamSchema,
        body: updateSupplySchema,
        response: { 200: supplyResponseSchema, 400: errorSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req) => repo.updateSupply(req.params.id, req.body),
  );

  r.delete(
    "/supplies/:id",
    {
      preHandler: requirePermission(Permission.SUPPLIES_WRITE),
      schema: {
        params: supplyIdParamSchema,
        response: { 204: noContentSchema, 404: errorSchema, ...protectedErrors },
      },
    },
    async (req, reply) => {
      await repo.deleteSupply(req.params.id);
      return reply.status(204).send();
    },
  );
}
