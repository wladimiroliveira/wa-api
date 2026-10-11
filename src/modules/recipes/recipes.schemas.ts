import { z } from "zod";
import { MeasurementUnit } from "../../generated/prisma/index.js";
import { positiveDecimalSchema } from "../../lib/decimal.js";

const productSchema = z.object({ sku: z.uuid(), description: z.string(), unit: z.enum(MeasurementUnit) });

export const recipeParamsSchema = z.object({ sku: z.uuid() });

// The yield is measured in the unit of the product, and each quantity in the unit of its own
// ingredient: the ingredients listed are what one batch of that yield takes.
export const saveRecipeBodySchema = z.object({
  yieldQuantity: positiveDecimalSchema,
  ingredients: z
    .array(z.object({ productSku: z.uuid(), quantity: positiveDecimalSchema }))
    .min(1)
    .refine(
      (ingredients) =>
        new Set(ingredients.map(({ productSku }) => productSku.toLowerCase())).size === ingredients.length,
      { message: "An ingredient is listed more than once." },
    ),
});

export const recipeSchema = z.object({
  product: productSchema,
  yieldQuantity: z.string(),
  ingredients: z.array(z.object({ product: productSchema, quantity: z.string() })),
  updatedAt: z.iso.datetime(),
});
