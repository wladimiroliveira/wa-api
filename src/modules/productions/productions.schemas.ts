import { z } from "zod";
import { lotExpirySchema } from "../stock/stock.schemas.js";
import { ProductionStatus } from "../../generated/prisma/index.js";
import { positiveDecimalSchema } from "../../lib/decimal.js";
import { pageQuerySchema, pageSchema } from "../../lib/pagination.js";
import { productSummarySchema } from "../products/products.schemas.js";

// An item is produced in one of two ways. Guided, it follows a pre-weighing: the product, the
// expected yield and the inputs are the ones weighed. Free, the operator picks the recipe and the
// yield they expect, and the inputs are the ones the recipe plans.
const guidedItemSchema = z.strictObject({ preWeighingId: z.uuid() });
const freeItemSchema = z.strictObject({ productSku: z.uuid(), quantity: positiveDecimalSchema });

export type ProductionItemRequest = z.infer<typeof guidedItemSchema> | z.infer<typeof freeItemSchema>;

const listsEachOnce = (ids: string[]) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

export const startProductionBodySchema = z.object({
  items: z
    .array(z.union([guidedItemSchema, freeItemSchema]))
    .min(1)
    .refine((items) => listsEachOnce(items.flatMap((item) => ("preWeighingId" in item ? [item.preWeighingId] : []))), {
      message: "A pre-weighing is listed more than once.",
    }),
});

export const finishProductionBodySchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), producedQuantity: positiveDecimalSchema, expiresAt: lotExpirySchema }))
    .min(1)
    .refine((items) => listsEachOnce(items.map(({ id }) => id)), { message: "An item is listed more than once." }),
});

export const productionIdParamsSchema = z.object({ id: z.uuid() });

export const listProductionsQuerySchema = pageQuerySchema.extend({ status: z.enum(ProductionStatus).optional() });

// What a production has not finished yet is null: the produced quantity, and the costs, which are
// those of the moment the inputs leave the stock.
export const productionSchema = z.object({
  id: z.uuid(),
  status: z.enum(ProductionStatus),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      product: productSummarySchema,
      preWeighingId: z.uuid().nullable(),
      expectedQuantity: z.string(),
      producedQuantity: z.string().nullable(),
      unitCost: z.string().nullable(),
      inputs: z.array(
        z.object({ product: productSummarySchema, quantity: z.string(), unitCost: z.string().nullable() }),
      ),
    }),
  ),
});

export const productionPageSchema = pageSchema(productionSchema);
