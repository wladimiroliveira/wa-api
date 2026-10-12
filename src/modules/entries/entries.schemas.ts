import { z } from "zod";
import { StockMovementType } from "../../generated/prisma/index.js";
import { localToday } from "../../lib/dates.js";
import { decimalSchema, positiveDecimalSchema } from "../../lib/decimal.js";
import { productSummarySchema } from "../products/products.schemas.js";
import { supplierSchema } from "../suppliers/suppliers.schemas.js";

// How an entry settles a balance that went negative: bring it to zero first, so the whole entry is
// in stock, or let the entry pay what is owed and keep only what is left.
export const DeficitSettlement = { ZERO: "ZERO", DISCOUNT: "DISCOUNT" } as const;

export type DeficitSettlement = (typeof DeficitSettlement)[keyof typeof DeficitSettlement];

export const createEntryBodySchema = z.object({
  productSku: z.uuid(),
  quantity: positiveDecimalSchema,
  unitCost: decimalSchema,
  // Not optional on purpose: a lot that never expires is said so, with null, rather than assumed
  // from a field left out.
  expiresAt: z.iso
    .date()
    .refine((date) => date >= localToday(), { message: "The lot has already expired." })
    .nullable(),
  supplierId: z.uuid().optional(),
  deficit: z.enum(DeficitSettlement).optional(),
});

export const entrySchema = z.object({
  id: z.uuid(),
  type: z.enum(StockMovementType),
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  lot: z.object({
    id: z.uuid(),
    expiresAt: z.iso.date().nullable(),
    supplier: supplierSchema.nullable(),
    quantity: z.string(),
  }),
  stock: z.object({ quantity: z.string(), lastEntryCost: z.string(), averageCost: z.string() }),
});

// A 409 that carries `deficit` is the negative balance waiting for the entry to say how to settle it.
export const entryConflictSchema = z.object({ message: z.string(), deficit: z.string().optional() });
