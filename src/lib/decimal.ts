import { z } from "zod";
import { Prisma } from "../generated/prisma/index.js";

// Amounts travel as decimal strings, in and out: a JSON number would round 0.1 + 0.2 before the
// database ever saw it. The shape mirrors numeric(18,6), twelve integer digits and six decimals.
export const decimalSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);

export const positiveDecimalSchema = decimalSchema.refine((value) => Number(value) > 0, {
  message: "Must be positive.",
});

const DECIMAL_PLACES = 6;
const UPPER_BOUND = new Prisma.Decimal("1e12");

// Rounds a computed amount to what numeric(18,6) holds. Null when it has more integer digits than
// the column.
export function toStoredDecimal(value: Prisma.Decimal): Prisma.Decimal | null {
  const rounded = value.toDecimalPlaces(DECIMAL_PLACES);

  return rounded.lt(UPPER_BOUND) ? rounded : null;
}
