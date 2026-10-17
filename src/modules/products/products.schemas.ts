import { z } from "zod";
import { MeasurementUnit, ProductKind } from "../../generated/prisma/index.js";
import { positiveDecimalSchema } from "../../lib/decimal.js";

// What another record shows of the product it refers to.
export const productSummarySchema = z.object({
  sku: z.uuid(),
  description: z.string(),
  unit: z.enum(MeasurementUnit),
});

export const productSchema = productSummarySchema.extend({
  gtin: z.string().nullable(),
  kind: z.enum(ProductKind),
  isActive: z.boolean(),
  // The quantity below which the stock asks for replenishment; null when none was set.
  minimumQuantity: z.string().nullable(),
});

const description = z.string().trim().min(1).max(120);
const gtin = z.string().regex(/^\d{8,14}$/);

export const createProductBodySchema = z.object({
  description,
  kind: z.enum(ProductKind),
  unit: z.enum(MeasurementUnit),
  gtin: gtin.optional(),
  minimumQuantity: positiveDecimalSchema.optional(),
});

// Kind and unit are not here: changing them would reread every quantity and cost already recorded.
export const updateProductBodySchema = z
  .object({
    description: description.optional(),
    gtin: gtin.nullable().optional(),
    isActive: z.boolean().optional(),
    minimumQuantity: positiveDecimalSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: "Nothing to update." });

export const productParamsSchema = z.object({ sku: z.uuid() });

// A parameter repeated in the query string arrives as an array, one written once as a string.
const oneOrMore = <Item extends z.ZodType>(item: Item) =>
  z.union([item, z.array(item)]).transform((value) => [value].flat() as z.output<Item>[]);

// No filter answers the whole catalog, inactive products included.
export const listProductsQuerySchema = z.object({
  // Part of the description or of the GTIN. A blank one searches nothing.
  q: z.string().trim().max(120).optional(),
  kind: oneOrMore(z.enum(ProductKind)).optional(),
  unit: oneOrMore(z.enum(MeasurementUnit)).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type ProductFilters = z.output<typeof listProductsQuerySchema>;

export const listsEachProductOnce = (items: { productSku: string }[]) =>
  new Set(items.map(({ productSku }) => productSku.toLowerCase())).size === items.length;
