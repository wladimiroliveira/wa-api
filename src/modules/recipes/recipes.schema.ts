import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const recipeItemSchema = z.object({
  supplyId: z.string().uuid(),
  usageQty: z.number().positive(),
  usageUnit: unitOfMeasureSchema,
});

export const createRecipeSchema = z.object({
  name: z.string().min(1),
  batchYield: z.number().positive(),
  laborCostPerHundred: z.number().nonnegative(),
  margin: z.number().nonnegative(),
  items: z.array(recipeItemSchema).min(1),
});

export const updateMarginSchema = z.object({ margin: z.number().nonnegative() });

export const recipeIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
