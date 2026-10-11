import { Prisma } from "../../generated/prisma/index.js";
import { toStoredDecimal } from "../../lib/decimal.js";

type Amount = Prisma.Decimal.Value;

// How much of an ingredient it takes to produce `quantity`, given that the recipe takes
// `recipeQuantity` of it to yield `yieldQuantity`. Null when the result is not a quantity the
// database holds: one that rounds down to nothing, or one with more digits than the column.
export function planQuantity(input: {
  recipeQuantity: Amount;
  yieldQuantity: Amount;
  quantity: Amount;
}): Prisma.Decimal | null {
  const planned = toStoredDecimal(
    new Prisma.Decimal(input.recipeQuantity).mul(input.quantity).div(input.yieldQuantity),
  );

  return planned?.gt(0) ? planned : null;
}
