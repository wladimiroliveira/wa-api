import { z } from "zod";

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
