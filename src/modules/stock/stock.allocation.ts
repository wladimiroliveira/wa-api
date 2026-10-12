import { Prisma } from "../../generated/prisma/index.js";

// Takes a quantity from the lots in the order they are given, emptying each before moving on to
// the next, and tells what they did not cover. Deciding the order is up to whoever lists the lots.
export function allocate<Lot extends { quantity: Prisma.Decimal }>(lots: Lot[], quantity: Prisma.Decimal) {
  const takes: { lot: Lot; quantity: Prisma.Decimal }[] = [];
  let shortfall = quantity;

  for (const lot of lots) {
    if (shortfall.lte(0)) break;

    const taken = Prisma.Decimal.min(lot.quantity, shortfall);

    takes.push({ lot, quantity: taken });
    shortfall = shortfall.sub(taken);
  }

  return { takes, shortfall };
}
