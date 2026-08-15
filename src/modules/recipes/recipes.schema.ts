import { z } from "zod";
import { supplyResponseSchema, unitOfMeasureSchema } from "../supplies/supplies.schema.js";
import { decimalSchema, timestampSchema } from "../shared/response.js";

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

export const updateRecipeSchema = z.object({
  name: z.string().min(1).optional(),
  batchYield: z.number().positive().optional(),
  laborCostPerHundred: z.number().nonnegative().optional(),
  margin: z.number().nonnegative().optional(),
  items: z.array(recipeItemSchema).min(1).optional(),
});

export const recipeIdParamSchema = z.object({ id: z.string().uuid() });

export type RecipeItemInput = z.infer<typeof recipeItemSchema>;
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

export const recipeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  batchYield: decimalSchema,
  laborCostPerHundred: decimalSchema,
  margin: decimalSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const recipeListResponseSchema = z.array(recipeResponseSchema);

export const recipeItemResponseSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  supplyId: z.string().uuid(),
  usageQty: decimalSchema,
  usageUnit: unitOfMeasureSchema,
});

/** POST e PATCH devolvem `include: { items: true }` — item sem o insumo. */
export const recipeWithItemsResponseSchema = recipeResponseSchema.extend({
  items: z.array(recipeItemResponseSchema),
});

/** GET /recipes/:id usa getRecipeWithItems, que aninha o insumo em cada item. */
export const recipeDetailResponseSchema = recipeResponseSchema.extend({
  items: z.array(recipeItemResponseSchema.extend({ supply: supplyResponseSchema })),
});
