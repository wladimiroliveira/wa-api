import { z } from "zod";
import { decimalSchema, timestampSchema } from "../shared/response.js";
import { stockMovementResponseSchema } from "../stock/stock.schema.js";
import { recipeResponseSchema } from "../recipes/recipes.schema.js";
import { supplyResponseSchema } from "../supplies/supplies.schema.js";
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

/** Lista e detalhe aninham a receita: a tela mostra o nome sem buscar a coleção inteira. */
export const productionListItemResponseSchema = productionResponseSchema.extend({ recipe: recipeResponseSchema });

export const productionPageResponseSchema = pageResponseSchema(productionListItemResponseSchema);

/** GET /productions/:id aninha o insumo em cada movimento, pelo mesmo motivo. */
export const productionMovementResponseSchema = stockMovementResponseSchema.extend({ supply: supplyResponseSchema });

export const productionDetailResponseSchema = productionListItemResponseSchema.extend({
  movements: z.array(productionMovementResponseSchema),
});

/** Warnings: insumos cujo saldo ficou negativo — a regra avisa, não bloqueia. */
export const registerProductionResponseSchema = z.object({
  production: productionResponseSchema,
  consumptions: z.array(z.object({ supplyId: z.string().uuid(), consumedBase: decimalSchema })),
  warnings: z.array(z.object({ supplyId: z.string().uuid(), resultingStock: decimalSchema })),
});
