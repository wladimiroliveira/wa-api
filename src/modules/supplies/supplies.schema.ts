import { z } from "zod";
import { decimalSchema, timestampSchema } from "../shared/response.js";

export const supplyTypeSchema = z.enum(["INGREDIENT", "PACKAGING"]);
export const unitOfMeasureSchema = z.enum(["G", "KG", "ML", "L", "UN"]);

export const createSupplySchema = z.object({
  name: z.string().min(1),
  type: supplyTypeSchema,
  purchaseUnit: unitOfMeasureSchema,
  purchaseQty: z.number().positive(),
  purchasePrice: z.number().nonnegative(),
});

export const updateSupplySchema = createSupplySchema.partial();

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateSupplyInput = z.infer<typeof createSupplySchema>;
export type UpdateSupplyInput = z.infer<typeof updateSupplySchema>;

export const supplyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: supplyTypeSchema,
  purchaseUnit: unitOfMeasureSchema,
  purchaseQty: decimalSchema,
  purchasePrice: decimalSchema,
  currentStock: decimalSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const supplyListResponseSchema = z.array(supplyResponseSchema);
