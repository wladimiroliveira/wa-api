import { z } from "zod";
import { StockMovementType } from "../../generated/prisma/index.js";
import { decimalSchema, positiveDecimalSchema } from "../../lib/decimal.js";
import { productSummarySchema } from "../products/products.schemas.js";

export const createEntryBodySchema = z.object({
  productSku: z.uuid(),
  quantity: positiveDecimalSchema,
  unitCost: decimalSchema,
});

export const entrySchema = z.object({
  id: z.uuid(),
  type: z.enum(StockMovementType),
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  stock: z.object({ quantity: z.string(), lastEntryCost: z.string(), averageCost: z.string() }),
});
