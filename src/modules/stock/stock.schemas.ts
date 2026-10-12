import { z } from "zod";
import { StockMovementType } from "../../generated/prisma/index.js";
import { pageQuerySchema, pageSchema } from "../../lib/pagination.js";
import { productSummarySchema } from "../products/products.schemas.js";

export const listStockMovementsQuerySchema = pageQuerySchema.extend({ productSku: z.uuid().optional() });

export const stockMovementSchema = z.object({
  id: z.uuid(),
  type: z.enum(StockMovementType),
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
});

export const stockMovementPageSchema = pageSchema(stockMovementSchema);
