import { z } from "zod";
import { unitOfMeasureSchema, supplyResponseSchema } from "../supplies/supplies.schema.js";
import { stockMovementResponseSchema, wasteReasonSchema } from "../stock/stock.schema.js";

export const createWasteSchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  reason: wasteReasonSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateWasteInput = z.infer<typeof createWasteSchema>;

/** GET /wastes lista movimentos com o insumo aninhado. */
export const wasteResponseSchema = stockMovementResponseSchema.extend({ supply: supplyResponseSchema });

export const wasteListResponseSchema = z.array(wasteResponseSchema);
