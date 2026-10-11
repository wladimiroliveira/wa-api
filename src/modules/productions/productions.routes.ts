import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { toPage } from "../../lib/pagination.js";
import { findProductionById, listProductions, ProductionRecord } from "./productions.repository.js";
import {
  finishProductionBodySchema,
  listProductionsQuerySchema,
  productionIdParamsSchema,
  productionPageSchema,
  productionSchema,
  startProductionBodySchema,
} from "./productions.schemas.js";
import { cancelProduction, finishProduction, startProduction } from "./productions.service.js";

const toResponse = (production: ProductionRecord) => ({
  id: production.id,
  status: production.status,
  createdAt: production.createdAt.toISOString(),
  finishedAt: production.finishedAt?.toISOString() ?? null,
  canceledAt: production.canceledAt?.toISOString() ?? null,
  items: production.items.map((item) => ({
    id: item.id,
    product: item.product,
    preWeighingId: item.preWeighingId,
    expectedQuantity: item.expectedQuantity.toString(),
    producedQuantity: item.producedQuantity?.toString() ?? null,
    unitCost: item.unitCost?.toString() ?? null,
    inputs: item.inputs.map(({ product, quantity, unitCost }) => ({
      product,
      quantity: quantity.toString(),
      unitCost: unitCost?.toString() ?? null,
    })),
  })),
});

export default async function productionsRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/productions",
    {
      config: { auth: Permission.PRODUCTION_CREATE },
      schema: {
        tags: ["productions"],
        summary: "Inicia uma produção, guiada por pré-pesagens ou livre pelas receitas",
        body: startProductionBodySchema,
        response: { 201: productionSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const result = await startProduction({ createdById: request.currentUser!.id, items: request.body.items });

      if ("failure" in result) {
        return reply.code(result.failure.code).send({ message: result.failure.message });
      }

      return reply.code(201).send(toResponse(result.production));
    },
  );

  typed.get(
    "/productions",
    {
      config: { auth: Permission.PRODUCTION_READ },
      schema: {
        tags: ["productions"],
        summary: "Lista as produções, das mais recentes para as mais antigas",
        querystring: listProductionsQuerySchema,
        response: { 200: productionPageSchema },
      },
    },
    async (request, reply) => {
      const { items, nextCursor } = toPage(await listProductions(request.query), request.query);

      return reply.send({ items: items.map(toResponse), nextCursor });
    },
  );

  typed.get(
    "/productions/:id",
    {
      config: { auth: Permission.PRODUCTION_READ },
      schema: {
        tags: ["productions"],
        summary: "Consulta uma produção e o que ela usa de cada insumo",
        params: productionIdParamsSchema,
        response: { 200: productionSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const production = await findProductionById(request.params.id);

      if (production === null) {
        return reply.code(404).send({ message: "Production not found." });
      }

      return reply.send(toResponse(production));
    },
  );

  typed.post(
    "/productions/:id/finish",
    {
      config: { auth: Permission.PRODUCTION_CREATE },
      schema: {
        tags: ["productions"],
        summary: "Finaliza uma produção: baixa os insumos e dá entrada no que foi produzido",
        params: productionIdParamsSchema,
        body: finishProductionBodySchema,
        response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const result = await finishProduction({
        id: request.params.id,
        createdById: request.currentUser!.id,
        items: request.body.items,
      });

      if ("failure" in result) {
        return reply.code(result.failure.code).send({ message: result.failure.message });
      }

      return reply.send(toResponse(result.production));
    },
  );

  typed.post(
    "/productions/:id/cancel",
    {
      config: { auth: Permission.PRODUCTION_CREATE },
      schema: {
        tags: ["productions"],
        summary: "Cancela uma produção em andamento e libera as pré-pesagens que a guiavam",
        params: productionIdParamsSchema,
        response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const result = await cancelProduction(request.params.id);

      if ("failure" in result) {
        return reply.code(result.failure.code).send({ message: result.failure.message });
      }

      return reply.send(toResponse(result.production));
    },
  );
}
