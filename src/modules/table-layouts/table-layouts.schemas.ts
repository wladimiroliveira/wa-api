import { z } from "zod";

// Keys are chosen by the web client, not typed by people: a short kebab-case slug is all they need.
const key = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

const MAX_COLUMNS = 40;

export const tableKeyParamsSchema = z.object({ tableKey: key });

export const tableLayoutBodySchema = z.object({
  order: z
    .array(key)
    .max(MAX_COLUMNS)
    .refine((columns) => new Set(columns).size === columns.length, { message: "Columns repeat." }),
  widths: z
    .record(key, z.int().min(40).max(2000))
    .refine((widths) => Object.keys(widths).length <= MAX_COLUMNS, { message: "Too many columns." }),
});

export const tableLayoutSchema = tableLayoutBodySchema.extend({ tableKey: z.string() });
