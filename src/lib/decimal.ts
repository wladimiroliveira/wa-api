import { z } from "zod";

// Amounts travel as decimal strings, in and out: a JSON number would round 0.1 + 0.2 before the
// database ever saw it. The shape mirrors numeric(18,6), twelve integer digits and six decimals.
export const decimalSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);

export const positiveDecimalSchema = decimalSchema.refine((value) => Number(value) > 0, {
  message: "Must be positive.",
});
