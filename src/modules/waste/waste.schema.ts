import { z } from "zod";
import { unitOfMeasureSchema, supplyResponseSchema } from "../supplies/supplies.schema.js";
import { stockMovementResponseSchema, wasteReasonSchema } from "../stock/stock.schema.js";
import { cursorPageQuerySchema, pageResponseSchema } from "../shared/pagination.js";
import { dateRangeFields, refineDateRange } from "../shared/date-range.js";

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

/** Livro-razão de perdas: página por cursor, opcionalmente recortada por período. */
export const wasteQuerySchema = refineDateRange(cursorPageQuerySchema.extend(dateRangeFields));

export type WasteQuery = z.infer<typeof wasteQuerySchema>;

export const wastePageResponseSchema = pageResponseSchema(wasteResponseSchema);
