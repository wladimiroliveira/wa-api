import { z } from "zod";
import { MeasurementUnit, ProductKind } from "../../generated/prisma/index.js";

// What another record shows of the product it refers to.
export const productSummarySchema = z.object({
  sku: z.uuid(),
  description: z.string(),
  unit: z.enum(MeasurementUnit),
});

export const productSchema = productSummarySchema.extend({
  gtin: z.string().nullable(),
  kind: z.enum(ProductKind),
  isActive: z.boolean(),
});

export const listsEachProductOnce = (items: { productSku: string }[]) =>
  new Set(items.map(({ productSku }) => productSku.toLowerCase())).size === items.length;
