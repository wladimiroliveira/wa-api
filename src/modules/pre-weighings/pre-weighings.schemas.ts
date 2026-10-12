import { z } from "zod";
import { positiveDecimalSchema } from "../../lib/decimal.js";
import { pageQuerySchema, pageSchema } from "../../lib/pagination.js";
import { listsEachProductOnce, productSummarySchema } from "../products/products.schemas.js";

// The quantity is how much of the product is to be produced, in the unit of the product.
const targetSchema = { productSku: z.uuid(), quantity: positiveDecimalSchema };

export const preWeighingPlanQuerySchema = z.object(targetSchema);

export const createPreWeighingBodySchema = z.object({
  ...targetSchema,
  items: z
    .array(z.object({ productSku: z.uuid(), weighedQuantity: positiveDecimalSchema }))
    .min(1)
    .refine(listsEachProductOnce, { message: "An item is listed more than once." }),
});

export const preWeighingIdParamsSchema = z.object({ id: z.uuid() });

// A pre-weighing is available while no production is using it.
export const listPreWeighingsQuerySchema = pageQuerySchema.extend({
  available: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const preWeighingPlanSchema = z.object({
  product: productSummarySchema,
  quantity: z.string(),
  items: z.array(
    z.object({
      product: productSummarySchema,
      plannedQuantity: z.string(),
      // Where to weigh it from, as the stock stands now, and what the stock does not have.
      lots: z.array(z.object({ id: z.uuid(), expiresAt: z.iso.date().nullable(), quantity: z.string() })),
      shortfall: z.string(),
    }),
  ),
});

export const preWeighingSchema = z.object({
  id: z.uuid(),
  product: productSummarySchema,
  quantity: z.string(),
  createdAt: z.iso.datetime(),
  items: z.array(z.object({ product: productSummarySchema, plannedQuantity: z.string(), weighedQuantity: z.string() })),
});

export const preWeighingPageSchema = pageSchema(preWeighingSchema);
