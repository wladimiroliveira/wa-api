import { z } from "zod";
import { decimalSchema, timestampSchema } from "../shared/response.js";
import { stockMovementResponseSchema } from "../stock/stock.schema.js";
import { cursorPageQuerySchema, pageResponseSchema } from "../shared/pagination.js";
import { dateRangeFields, refineDateRange } from "../shared/date-range.js";

export const createProductionSchema = z
  .object({
    recipeId: z.string().uuid(),
    batches: z.number().positive().optional(),
    producedQty: z.number().positive().optional(),
    note: z.string().optional(),
  })
  .refine((d) => (d.batches === undefined) !== (d.producedQty === undefined), {
    message: "Informe exatamente um entre batches e producedQty",
  });

export const productionIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateProductionInput = z.infer<typeof createProductionSchema>;

export const productionResponseSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  factor: decimalSchema,
  producedUnits: decimalSchema,
  note: z.string().nullable(),
  createdAt: timestampSchema,
});

/** Livro-razão de produções: página por cursor, opcionalmente recortada por período. */
export const productionQuerySchema = refineDateRange(cursorPageQuerySchema.extend(dateRangeFields));

export type ProductionQuery = z.infer<typeof productionQuerySchema>;

export const productionPageResponseSchema = pageResponseSchema(productionResponseSchema);

export const productionDetailResponseSchema = productionResponseSchema.extend({
  movements: z.array(stockMovementResponseSchema),
});

/** Warnings: insumos cujo saldo ficou negativo — a regra avisa, não bloqueia. */
export const registerProductionResponseSchema = z.object({
  production: productionResponseSchema,
  consumptions: z.array(z.object({ supplyId: z.string().uuid(), consumedBase: decimalSchema })),
  warnings: z.array(z.object({ supplyId: z.string().uuid(), resultingStock: decimalSchema })),
});
