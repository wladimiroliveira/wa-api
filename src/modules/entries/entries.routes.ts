import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { findProductBySku, insertEntry } from "./entries.repository.js";
import { createEntryBodySchema, entrySchema } from "./entries.schemas.js";

export default async function entriesRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/entries",
    {
      config: { auth: Permission.ENTRIES_CREATE },
      schema: {
        tags: ["entries"],
        summary: "Lança a entrada de um produto e soma ao estoque",
        body: createEntryBodySchema,
        response: { 201: entrySchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const product = await findProductBySku(request.body.productSku);

      if (product === null) {
        return reply.code(404).send({ message: "Product not found." });
      }

      if (!product.isActive) {
        return reply.code(409).send({ message: "Product is inactive." });
      }

      const { movement, stock } = await insertEntry({ ...request.body, createdById: request.currentUser!.id });

      return reply.code(201).send({
        id: movement.id,
        type: movement.type,
        quantity: movement.quantity.toString(),
        unitCost: movement.unitCost.toString(),
        createdAt: movement.createdAt.toISOString(),
        product: { sku: product.sku, description: product.description, unit: product.unit },
        stock: {
          quantity: stock.quantity.toString(),
          lastEntryCost: stock.lastEntryCost.toString(),
          averageCost: stock.averageCost.toString(),
        },
      });
    },
  );
}
