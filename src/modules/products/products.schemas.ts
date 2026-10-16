import { z } from "zod";
import { MeasurementUnit, ProductKind } from "../../generated/prisma/index.js";
import { positiveDecimalSchema } from "../../lib/decimal.js";

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
  // The quantity below which the stock asks for replenishment; null when none was set.
  minimumQuantity: z.string().nullable(),
});

const description = z.string().trim().min(1).max(120);
const gtin = z.string().regex(/^\d{8,14}$/);

export const createProductBodySchema = z.object({
  description,
  kind: z.enum(ProductKind),
  unit: z.enum(MeasurementUnit),
  gtin: gtin.optional(),
  minimumQuantity: positiveDecimalSchema.optional(),
});

// Kind and unit are not here: changing them would reread every quantity and cost already recorded.
export const updateProductBodySchema = z
  .object({
    description: description.optional(),
    gtin: gtin.nullable().optional(),
    isActive: z.boolean().optional(),
    minimumQuantity: positiveDecimalSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: "Nothing to update." });

export const productParamsSchema = z.object({ sku: z.uuid() });

export const listsEachProductOnce = (items: { productSku: string }[]) =>
  new Set(items.map(({ productSku }) => productSku.toLowerCase())).size === items.length;
