import { z } from "zod";
import { MeasurementUnit, StockMovementType } from "../../generated/prisma/index.js";

// Amounts travel as decimal strings, in and out: a JSON number would round 0.1 + 0.2 before the
// database ever saw it. The shape mirrors numeric(18,6), twelve integer digits and six decimals.
const decimalSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);

export const createEntryBodySchema = z.object({
  productSku: z.uuid(),
  quantity: decimalSchema.refine((value) => Number(value) > 0, { message: "Quantity must be positive." }),
  unitCost: decimalSchema,
});

export const entrySchema = z.object({
  id: z.uuid(),
  type: z.enum(StockMovementType),
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: z.object({ sku: z.uuid(), description: z.string(), unit: z.enum(MeasurementUnit) }),
  stock: z.object({ quantity: z.string(), lastEntryCost: z.string(), averageCost: z.string() }),
});
