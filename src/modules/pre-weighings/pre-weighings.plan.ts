import { Prisma } from "../../generated/prisma/index.js";

type Amount = Prisma.Decimal.Value;

// The shape of numeric(18,6): six decimal places and twelve integer digits.
const DECIMAL_PLACES = 6;
const UPPER_BOUND = new Prisma.Decimal("1e12");

// How much of an ingredient it takes to produce `quantity`, given that the recipe takes
// `recipeQuantity` of it to yield `yieldQuantity`. Null when the result is not a quantity the
// database holds: one that rounds down to nothing, or one with more digits than the column.
export function planQuantity(input: {
  recipeQuantity: Amount;
  yieldQuantity: Amount;
  quantity: Amount;
}): Prisma.Decimal | null {
  const planned = new Prisma.Decimal(input.recipeQuantity)
    .mul(input.quantity)
    .div(input.yieldQuantity)
    .toDecimalPlaces(DECIMAL_PLACES);

  return planned.gt(0) && planned.lt(UPPER_BOUND) ? planned : null;
}
