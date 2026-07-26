import { z } from "zod";

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
