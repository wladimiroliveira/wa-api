import { z } from "zod";
import { StockMovementType } from "../../generated/prisma/index.js";
import { pageQuerySchema, pageSchema } from "../../lib/pagination.js";
import { productSummarySchema } from "../products/products.schemas.js";
import { StockStatus } from "./stock.position.js";

export const listStockMovementsQuerySchema = pageQuerySchema.extend({ productSku: z.uuid().optional() });

export const stockMovementSchema = z.object({
  id: z.uuid(),
  type: z.enum(StockMovementType),
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
});

export const stockMovementPageSchema = pageSchema(stockMovementSchema);

export const stockPositionSchema = z.object({
  items: z.array(
    z.object({
      product: productSummarySchema,
      quantity: z.string(),
      minimumQuantity: z.string().nullable(),
      lastEntryCost: z.string().nullable(),
      averageCost: z.string().nullable(),
      value: z.string(),
      status: z.enum(StockStatus),
    }),
  ),
  totalValue: z.string(),
});
