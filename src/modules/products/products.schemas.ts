import { z } from "zod";
import { MeasurementUnit } from "../../generated/prisma/index.js";

// What another record shows of the product it refers to.
export const productSummarySchema = z.object({
  sku: z.uuid(),
  description: z.string(),
  unit: z.enum(MeasurementUnit),
});

export const listsEachProductOnce = (items: { productSku: string }[]) =>
  new Set(items.map(({ productSku }) => productSku.toLowerCase())).size === items.length;
