import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const createStockEntrySchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;
