import { z } from "zod";
import { StockMovementType } from "../../generated/prisma/index.js";
import { pageQuerySchema, pageSchema } from "../../lib/pagination.js";
import { productSummarySchema } from "../products/products.schemas.js";
import { supplierSchema } from "../suppliers/suppliers.schemas.js";
import { LotStatus, StockStatus } from "./stock.position.js";

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

const stockItemSchema = z.object({
  product: productSummarySchema,
  quantity: z.string(),
  minimumQuantity: z.string().nullable(),
  lastEntryCost: z.string().nullable(),
  averageCost: z.string().nullable(),
  value: z.string(),
  lotCount: z.number().int(),
  nextExpiresAt: z.iso.date().nullable(),
  status: z.enum(StockStatus),
});

export const stockPositionSchema = z.object({ items: z.array(stockItemSchema), totalValue: z.string() });

export const productStockParamsSchema = z.object({ sku: z.uuid() });

// Lots with nothing left are history, so they come only when asked for.
export const productStockQuerySchema = z.object({ depleted: z.enum(["true", "false"]).default("false") });

export const productStockSchema = stockItemSchema.extend({
  lots: z.array(
    z.object({
      id: z.uuid(),
      expiresAt: z.iso.date().nullable(),
      supplier: supplierSchema.nullable(),
      initialQuantity: z.string(),
      quantity: z.string(),
      unitCost: z.string(),
      value: z.string(),
      createdAt: z.iso.datetime(),
      status: z.enum(LotStatus),
    }),
  ),
});
