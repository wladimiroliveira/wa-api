import { z } from "zod";
import { positiveDecimalSchema } from "../../lib/decimal.js";
import { listsEachProductOnce, productSummarySchema } from "../products/products.schemas.js";

export const recipeParamsSchema = z.object({ sku: z.uuid() });

// The yield is measured in the unit of the product, and each quantity in the unit of its own
// ingredient: the ingredients listed are what one batch of that yield takes.
export const saveRecipeBodySchema = z.object({
  yieldQuantity: positiveDecimalSchema,
  ingredients: z
    .array(z.object({ productSku: z.uuid(), quantity: positiveDecimalSchema }))
    .min(1)
    .refine(listsEachProductOnce, { message: "An ingredient is listed more than once." }),
});

export const recipeSchema = z.object({
  product: productSummarySchema,
  yieldQuantity: z.string(),
  ingredients: z.array(z.object({ product: productSummarySchema, quantity: z.string() })),
  updatedAt: z.iso.datetime(),
});

// What a list of recipes shows of each one: enough to tell them apart, not the ingredients themselves.
export const recipeSummarySchema = z.object({
  product: productSummarySchema,
  yieldQuantity: z.string(),
  ingredientCount: z.number().int(),
  updatedAt: z.iso.datetime(),
});
