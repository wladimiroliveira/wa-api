import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { MeasurementUnit, Permission, Prisma } from "../../generated/prisma/index.js";
import { toPage } from "../../lib/pagination.js";
import { localToday, toOptionalDateString } from "../../lib/dates.js";
import { messageSchema } from "../auth/auth.schemas.js";
import { lotCountOf, lotStatusOf, lotValueOf, nextExpiryOf, statusOf, valueOf } from "./stock.position.js";
import { findProductWithStock, listProductsWithStock, listStockMovements } from "./stock.repository.js";
import {
  listStockMovementsQuerySchema,
  productStockParamsSchema,
  productStockQuerySchema,
  productStockSchema,
  stockMovementPageSchema,
  stockPositionSchema,
} from "./stock.schemas.js";

type Product = { sku: string; description: string; unit: MeasurementUnit };
type Stock = {
  quantity: Prisma.Decimal;
  lastEntryCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  minimumQuantity: Prisma.Decimal | null;
};
type Lot = { quantity: Prisma.Decimal; unitCost: Prisma.Decimal; expiresAt: Date | null };

// The one place that reads a product, its balance and its lots as a position, so the list and the
// detail of a product can never tell two different stories about it.
function toPosition(product: Product, stock: Stock | null, lots: Lot[], today: string) {
  const balance = stock ?? NO_STOCK;

  return {
    product,
    quantity: balance.quantity.toString(),
    minimumQuantity: balance.minimumQuantity?.toString() ?? null,
    lastEntryCost: balance.lastEntryCost?.toString() ?? null,
    averageCost: balance.averageCost?.toString() ?? null,
    value: valueOf(lots).toFixed(2),
    lotCount: lotCountOf(lots),
    nextExpiresAt: nextExpiryOf(lots),
    status: statusOf(balance, lots, today),
  };
}

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
        items: items.map(({ lot, ...movement }) => ({
          ...movement,
          lot: lot === null ? null : { ...lot, expiresAt: toOptionalDateString(lot.expiresAt) },
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
      const today = localToday();
      const positions = (await listProductsWithStock()).map(({ stock, lots, ...product }) => ({
        position: toPosition(product, stock, lots, today),
        value: valueOf(lots),
      }));

      return reply.send({
        items: positions.map(({ position }) => position),
        totalValue: Prisma.Decimal.sum(0, ...positions.map(({ value }) => value)).toFixed(2),
      });
    },
  );

  typed.get(
    "/stock/:sku",
    {
      config: { auth: Permission.REPORTS_READ },
      schema: {
        tags: ["stock"],
        summary: "Posição de estoque de um produto e os lotes que a compõem",
        params: productStockParamsSchema,
        querystring: productStockQuerySchema,
        response: { 200: productStockSchema, 404: messageSchema },
      },
    },
    async (request, reply) => {
      const found = await findProductWithStock(request.params.sku, { depleted: request.query.depleted === "true" });

      if (found === null) {
        return reply.code(404).send({ message: "Product not found." });
      }

      const today = localToday();
      const { stock, lots, ...product } = found;

      return reply.send({
        ...toPosition(product, stock, lots, today),
        lots: lots.map((lot) => ({
          id: lot.id,
          expiresAt: toOptionalDateString(lot.expiresAt),
          supplier: lot.supplier,
          initialQuantity: lot.initialQuantity.toString(),
          quantity: lot.quantity.toString(),
          unitCost: lot.unitCost.toString(),
          value: lotValueOf(lot).toFixed(2),
          createdAt: lot.createdAt.toISOString(),
          status: lotStatusOf(lot, today),
        })),
      });
    },
  );
}
