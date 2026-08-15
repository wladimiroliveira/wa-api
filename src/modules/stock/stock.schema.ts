import { z } from "zod";
import { unitOfMeasureSchema } from "../supplies/supplies.schema.js";
import { StockMovementType, WasteReason } from "../../generated/prisma/index.js";
import { decimalSchema, timestampSchema } from "../shared/response.js";

export const createStockEntrySchema = z.object({
  quantity: z.number().positive(),
  unit: unitOfMeasureSchema,
  note: z.string().optional(),
});

export const supplyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;

export const stockMovementTypeSchema = z.enum(StockMovementType);

/** Mora aqui porque `reason` é campo de StockMovement; waste importa deste arquivo. */
export const wasteReasonSchema = z.enum(WasteReason);

export const stockMovementResponseSchema = z.object({
  id: z.string().uuid(),
  supplyId: z.string().uuid(),
  type: stockMovementTypeSchema,
  quantityBase: decimalSchema,
  reason: wasteReasonSchema.nullable(),
  note: z.string().nullable(),
  productionId: z.string().uuid().nullable(),
  createdAt: timestampSchema,
});

export const stockMovementListResponseSchema = z.array(stockMovementResponseSchema);

/** Envelope de criação compartilhado com waste: o movimento mais o saldo resultante. */
export const stockEntryResponseSchema = z.object({
  movement: stockMovementResponseSchema,
  currentStock: decimalSchema,
});
