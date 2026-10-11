import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { toPage } from "../../lib/pagination.js";
import {
  findPreWeighingById,
  insertPreWeighing,
  listPreWeighings,
  PreWeighingRecord,
} from "./pre-weighings.repository.js";
import {
  createPreWeighingBodySchema,
  listPreWeighingsQuerySchema,
  preWeighingIdParamsSchema,
  preWeighingPageSchema,
  preWeighingPlanQuerySchema,
  preWeighingPlanSchema,
  preWeighingSchema,
} from "./pre-weighings.schemas.js";
import { planPreWeighing } from "./pre-weighings.service.js";

const toResponse = (preWeighing: PreWeighingRecord) => ({
  id: preWeighing.id,
  product: preWeighing.product,
  quantity: preWeighing.quantity.toString(),
  createdAt: preWeighing.createdAt.toISOString(),
  items: preWeighing.items.map(({ product, plannedQuantity, weighedQuantity }) => ({
    product,
    plannedQuantity: plannedQuantity.toString(),
    weighedQuantity: weighedQuantity.toString(),
  })),
});

export default async function preWeighingsRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/pre-weighings/plan",
    {
      config: { auth: Permission.PRODUCTION_READ },
      schema: {
        tags: ["pre-weighings"],
        summary: "Calcula quanto pesar de cada ingrediente para produzir uma quantidade",
        querystring: preWeighingPlanQuerySchema,
        response: { 200: preWeighingPlanSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const result = await planPreWeighing(request.query.productSku, request.query.quantity);

      if ("failure" in result) {
        return reply.code(result.failure.code).send({ message: result.failure.message });
      }

      return reply.send({
        product: result.plan.product,
        quantity: result.plan.quantity.toString(),
        items: result.plan.items.map(({ product, plannedQuantity }) => ({
          product,
          plannedQuantity: plannedQuantity.toString(),
        })),
      });
    },
  );

  typed.post(
    "/pre-weighings",
    {
      config: { auth: Permission.PRODUCTION_CREATE },
      schema: {
        tags: ["pre-weighings"],
        summary: "Registra a pré-pesagem dos ingredientes de um produto",
        body: createPreWeighingBodySchema,
        response: { 201: preWeighingSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const { productSku, quantity, items } = request.body;
      const result = await planPreWeighing(productSku, quantity);

      if ("failure" in result) {
        return reply.code(result.failure.code).send({ message: result.failure.message });
      }

      const weighedBySku = new Map(items.map((item) => [item.productSku.toLowerCase(), item.weighedQuantity]));
      const planned = result.plan.items;

      if (planned.length !== weighedBySku.size || planned.some(({ product }) => !weighedBySku.has(product.sku))) {
        return reply.code(409).send({ message: "The items do not match the ingredients of the recipe." });
      }

      const preWeighing = await insertPreWeighing({
        productSku,
        quantity,
        createdById: request.currentUser!.id,
        items: planned.map(({ product, plannedQuantity }) => ({
          productSku: product.sku,
          plannedQuantity,
          weighedQuantity: weighedBySku.get(product.sku)!,
        })),
      });

      return reply.code(201).send(toResponse(preWeighing));
    },
  );

  typed.get(
    "/pre-weighings",
    {
      config: { auth: Permission.PRODUCTION_READ },
      schema: {
        tags: ["pre-weighings"],
        summary: "Lista as pré-pesagens, das mais recentes para as mais antigas",
        querystring: listPreWeighingsQuerySchema,
        response: { 200: preWeighingPageSchema },
      },
    },
    async (request, reply) => {
      const { items, nextCursor } = toPage(await listPreWeighings(request.query), request.query);

      return reply.send({ items: items.map(toResponse), nextCursor });
    },
  );

  typed.get(
    "/pre-weighings/:id",
    {
      config: { auth: Permission.PRODUCTION_READ },
      schema: {
        tags: ["pre-weighings"],
        summary: "Consulta uma pré-pesagem registrada",
        params: preWeighingIdParamsSchema,
        response: { 200: preWeighingSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const preWeighing = await findPreWeighingById(request.params.id);

      if (preWeighing === null) {
        return reply.code(404).send({ message: "Pre-weighing not found." });
      }

      return reply.send(toResponse(preWeighing));
    },
  );
}
