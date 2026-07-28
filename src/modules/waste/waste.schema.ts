import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";

export const wasteReasonSchema = z.enum(["SPOILED", "DROPPED", "EXPIRED", "OTHER"]);

export const createWasteSchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  reason: wasteReasonSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateWasteInput = z.infer<typeof createWasteSchema>;
