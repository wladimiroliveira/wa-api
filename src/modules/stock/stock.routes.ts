import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission, Prisma } from "../../generated/prisma/index.js";
import { toPage } from "../../lib/pagination.js";
import { statusOf, valueOf } from "./stock.position.js";
import { listProductsWithStock, listStockMovements } from "./stock.repository.js";
import { listStockMovementsQuerySchema, stockMovementPageSchema, stockPositionSchema } from "./stock.schemas.js";

const NO_STOCK = { quantity: new Prisma.Decimal(0), lastEntryCost: null, averageCost: null, minimumQuantity: null };

export default async function stockRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/stock-movements",
    {
      config: { auth: Permission.ENTRIES_READ },
      schema: {
        tags: ["stock"],
        summary: "Lista as movimentações de estoque, das mais recentes para as mais antigas",
        querystring: listStockMovementsQuerySchema,
        response: { 200: stockMovementPageSchema },
      },
    },
    async (request, reply) => {
      const { items, nextCursor } = toPage(await listStockMovements(request.query), request.query);

      return reply.send({
        items: items.map((movement) => ({
          ...movement,
          quantity: movement.quantity.toString(),
          unitCost: movement.unitCost.toString(),
          createdAt: movement.createdAt.toISOString(),
        })),
        nextCursor,
      });
    },
  );

  typed.get(
    "/stock",
    {
      config: { auth: Permission.REPORTS_READ },
      schema: {
        tags: ["stock"],
        summary: "Posição de estoque de cada produto e o valor total em estoque",
        response: { 200: stockPositionSchema },
      },
    },
    async (_request, reply) => {
      const positions = (await listProductsWithStock()).map(({ stock, ...product }) => {
        const balance = stock ?? NO_STOCK;

        return { product, balance, value: valueOf(balance), status: statusOf(balance) };
      });

      return reply.send({
        items: positions.map(({ product, balance, value, status }) => ({
          product,
          quantity: balance.quantity.toString(),
          minimumQuantity: balance.minimumQuantity?.toString() ?? null,
          lastEntryCost: balance.lastEntryCost?.toString() ?? null,
          averageCost: balance.averageCost?.toString() ?? null,
          value: value.toFixed(2),
          status,
        })),
        totalValue: Prisma.Decimal.sum(0, ...positions.map(({ value }) => value)).toFixed(2),
      });
    },
  );
}
